import * as fs from "fs/promises";
import * as path from "path";
import { broadcast } from "../broadcast.js";
import { getRunsDir } from "./paths.js";
import { startAgentRun, cancelAgentRun } from "./agent-runner.js";
import { shouldStopBulk } from "./bulk-stop-condition.js";
import type {
  AgentProvider,
  BulkRunOptions,
  BulkSessionSnapshot,
  BulkSessionStatus,
  RunResult,
} from "./contract-types.js";
import type { AgentRunConfig } from "./agent-config.js";

export interface BulkStoryInput {
  runId: string;
  storyName: string;
  storyTitle: string;
  storyContents: string;
}

export type BulkItemPhase = "pending" | "running" | "done" | "skipped";

interface BulkItemState extends BulkStoryInput {
  phase: BulkItemPhase;
  result?: RunResult;
}

interface BulkSession {
  bulkId: string;
  status: BulkSessionStatus;
  maxParallel: number;
  stopCondition: string;
  stopReason?: string;
  items: BulkItemState[];
  provider: AgentProvider;
  agentBinary: string;
  runHook?: string;
  agentConfig?: AgentRunConfig;
  /** Resolvers waiting for stop/cancel to finish cancelling in-flight work. */
  abort: boolean;
}

const DEFAULT_MAX_PARALLEL = 3;
const HARD_MAX_PARALLEL = 8;

const _sessions = new Map<string, BulkSession>();

function clampParallel(n: number | undefined): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return DEFAULT_MAX_PARALLEL;
  return Math.max(1, Math.min(HARD_MAX_PARALLEL, Math.floor(n)));
}

function toSnapshot(session: BulkSession): BulkSessionSnapshot {
  return {
    bulkId: session.bulkId,
    status: session.status,
    maxParallel: session.maxParallel,
    stopCondition: session.stopCondition,
    stopReason: session.stopReason,
    items: session.items.map((item) => ({
      storyName: item.storyName,
      storyTitle: item.storyTitle,
      runId: item.runId,
      phase: item.phase,
    })),
  };
}

function publish(session: BulkSession): void {
  broadcast("bulk:status", toSnapshot(session));
}

async function persistPlan(session: BulkSession): Promise<void> {
  const runsDir = getRunsDir();
  const bulkRoot = path.join(runsDir, `bulk-${session.bulkId}`);
  await fs.mkdir(bulkRoot, { recursive: true });
  await fs.writeFile(
    path.join(bulkRoot, "run-plan.json"),
    JSON.stringify(
      {
        bulkId: session.bulkId,
        provider: session.provider,
        status: session.status,
        stopReason: session.stopReason,
        maxParallel: session.maxParallel,
        stopCondition: session.stopCondition,
        startedAt: Date.now(),
        storyCount: session.items.length,
        stories: session.items.map((s) => ({
          runId: s.runId,
          storyName: s.storyName,
          storyTitle: s.storyTitle,
          phase: s.phase,
        })),
      },
      null,
      2,
    ),
    "utf-8",
  );
}

/**
 * Bulk runs start one independent agent process per story, limited by
 * maxParallel. An optional stopCondition can halt remaining work; skipped
 * stories can later be resumed via resumeBulkRun.
 */
export async function startBulkRun(
  bulkId: string,
  stories: BulkStoryInput[],
  provider: AgentProvider,
  agentBinary: string,
  runHook?: string,
  options?: BulkRunOptions,
  agentConfig?: AgentRunConfig,
): Promise<void> {
  const session: BulkSession = {
    bulkId,
    status: "running",
    maxParallel: clampParallel(options?.maxParallel),
    stopCondition: options?.stopCondition?.trim() ?? "",
    items: stories.map((s) => ({ ...s, phase: "pending" as const })),
    provider,
    agentBinary,
    runHook,
    agentConfig,
    abort: false,
  };
  _sessions.set(bulkId, session);
  await persistPlan(session);
  publish(session);

  console.log("[bulk]", {
    bulkId,
    provider,
    storyCount: stories.length,
    maxParallel: session.maxParallel,
    stopCondition: session.stopCondition || undefined,
    agentBinary,
  });

  await runBulkWorkers(session);
}

export async function stopBulkRun(
  bulkId: string,
  reason = "Stopped by user",
): Promise<BulkSessionSnapshot | null> {
  const session = _sessions.get(bulkId);
  if (!session || session.status !== "running") return session ? toSnapshot(session) : null;

  session.abort = true;
  session.status = "stopped";
  session.stopReason = reason;

  for (const item of session.items) {
    if (item.phase === "running") {
      await cancelAgentRun(item.runId).catch(() => false);
      // Keep them resumeable — a cancelled child run is not "done" for the bulk.
      item.phase = "skipped";
    } else if (item.phase === "pending") {
      item.phase = "skipped";
    }
  }

  await persistPlan(session);
  publish(session);
  return toSnapshot(session);
}

export async function resumeBulkRun(
  bulkId: string,
  nextStories: BulkStoryInput[],
  provider: AgentProvider,
  agentBinary: string,
  runHook?: string,
  options?: BulkRunOptions,
  agentConfig?: AgentRunConfig,
): Promise<void> {
  // Prefer extending the existing session when present; otherwise start fresh
  // with the same bulkId so the UI can keep tracking it.
  const existing = _sessions.get(bulkId);
  if (existing && existing.status === "running") {
    throw new Error(`Bulk run is already active: ${bulkId}`);
  }

  const session: BulkSession = {
    bulkId,
    status: "running",
    maxParallel: clampParallel(options?.maxParallel ?? existing?.maxParallel),
    stopCondition:
      options?.stopCondition?.trim() ?? existing?.stopCondition ?? "",
    items: [
      ...(existing?.items.filter((i) => i.phase === "done") ?? []),
      ...nextStories.map((s) => ({ ...s, phase: "pending" as const })),
    ],
    provider,
    agentBinary,
    runHook,
    agentConfig,
    abort: false,
  };
  // Clear previous skipped items that are being retried.
  session.stopReason = undefined;
  _sessions.set(bulkId, session);
  await persistPlan(session);
  publish(session);

  console.log("[bulk:resume]", {
    bulkId,
    storyCount: nextStories.length,
    maxParallel: session.maxParallel,
  });

  await runBulkWorkers(session);
}

export function getBulkSession(bulkId: string): BulkSessionSnapshot | null {
  const session = _sessions.get(bulkId);
  return session ? toSnapshot(session) : null;
}

async function runBulkWorkers(session: BulkSession): Promise<void> {
  let cursor = 0;

  const worker = async () => {
    while (!session.abort) {
      const index = cursor++;
      if (index >= session.items.length) return;
      const item = session.items[index];
      if (item.phase !== "pending") continue;

      item.phase = "running";
      publish(session);

      try {
        const result = await startAgentRun(
          session.provider,
          item.runId,
          item.storyName,
          item.storyTitle,
          item.storyContents,
          session.agentBinary,
          session.runHook,
          session.agentConfig,
        );
        item.result = result;
        // Don't overwrite skipped — stop/cancel may have already reserved this
        // story for resume while the cancelled agent was winding down.
        if (item.phase === "running") {
          item.phase = "done";
        }
        publish(session);

        if (
          item.phase === "done" &&
          !session.abort &&
          session.status === "running" &&
          shouldStopBulk(session.stopCondition, result)
        ) {
          session.abort = true;
          session.status = "stopped";
          session.stopReason = `Stop condition matched after “${item.storyTitle}” (${result.status})`;
          for (const other of session.items) {
            if (other.runId === item.runId) continue;
            if (other.phase === "pending" || other.phase === "running") {
              if (other.phase === "running") {
                await cancelAgentRun(other.runId).catch(() => false);
              }
              other.phase = "skipped";
            }
          }
          publish(session);
          return;
        }
      } catch (err) {
        console.error("[bulk] child run error", {
          bulkId: session.bulkId,
          runId: item.runId,
          err: String(err),
        });
        if (item.phase === "running") {
          item.phase = "done";
        }
        publish(session);
      }
    }
  };

  const workers = Array.from(
    { length: Math.min(session.maxParallel, session.items.length) },
    () => worker(),
  );
  await Promise.all(workers);

  if (session.status === "running") {
    const anySkipped = session.items.some((i) => i.phase === "skipped");
    session.status = anySkipped ? "stopped" : "completed";
    if (anySkipped && !session.stopReason) {
      session.stopReason = "Bulk run stopped";
    }
  }

  await persistPlan(session);
  publish(session);

  // Keep stopped sessions around for resume; drop completed ones.
  if (session.status === "completed") {
    _sessions.delete(session.bulkId);
  }
}
