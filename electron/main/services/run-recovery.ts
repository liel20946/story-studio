import * as fs from "fs/promises";
import * as path from "path";
import { broadcast } from "../broadcast.js";
import type {
  ActiveRunSnapshot,
  AssertionResult,
  RunEvent,
  RunRecord,
  RunResult,
  RunStatus,
} from "./contract-types.js";
import { getHeroScreenshotPath, enrichRunResult } from "./run-artifacts.js";
import { markRunCancelled, settleRunningEvents } from "./run-event-settle.js";
import {
  deletePersistedRunEvents,
  deleteRunPid,
  isProcessAlive,
  loadRecoverableRunEvents,
  readRunPid,
} from "./run-events-persist.js";
import { getRunsDir } from "./paths.js";
import { deleteRunMeta, readRunMeta, type RunMeta } from "./run-meta.js";
import { listRuns, saveRun, buildScreenshotUrl } from "./run-service.js";

interface RecoveredRun {
  meta: RunMeta;
  events: RunEvent[];
  pollTimer: ReturnType<typeof setInterval>;
}

const _recovered = new Map<string, RecoveredRun>();

const POLL_MS = 2_000;

export function listRecoveredRuns(): ActiveRunSnapshot[] {
  return Array.from(_recovered.values()).map(({ meta, events }) => ({
    runId: meta.runId,
    storyName: meta.storyName,
    storyTitle: meta.storyTitle,
    startedAt: meta.startedAt,
    agentProvider: meta.agentProvider,
    agentModel: meta.agentModel,
    events,
  }));
}

export function isRecoveredRun(runId: string): boolean {
  return _recovered.has(runId);
}

function stopWatchingRecoveredRun(runId: string): RecoveredRun | undefined {
  const entry = _recovered.get(runId);
  if (!entry) return undefined;
  clearInterval(entry.pollTimer);
  _recovered.delete(runId);
  return entry;
}

async function finalizeRecoveredRun(
  meta: RunMeta,
  events: RunEvent[],
  result: RunResult,
): Promise<void> {
  settleRunningEvents(events, result.status, false);
  const enriched = await enrichRunResult(result);
  const record: RunRecord = { ...enriched, events };
  await saveRun(record);
  await deleteRunMeta(meta.runId);
  await deleteRunPid(meta.runId);
  await deletePersistedRunEvents(meta.runId);
  broadcast("run:result", enriched);
}

/** Finalize an orphaned run the user dismissed after app restart (no live agent handle). */
export async function cancelRecoveredRun(runId: string): Promise<boolean> {
  const entry = stopWatchingRecoveredRun(runId);
  const meta = entry?.meta ?? (await readRunMeta(runId));
  if (!meta) return false;

  const events = entry?.events ?? (await loadRecoverableRunEvents(runId));
  const nextSeq = events.reduce((max, e) => Math.max(max, e.seq), 0) + 1;
  markRunCancelled(events, meta.runId, nextSeq);

  const screenshotPath = getHeroScreenshotPath(meta.runId);
  const result: RunResult = {
    runId: meta.runId,
    storyName: meta.storyName,
    storyTitle: meta.storyTitle,
    status: "cancelled",
    summary: "Cancelled by user",
    assertions: [],
    screenshotPath,
    screenshotUrl: buildScreenshotUrl(meta.runId, screenshotPath),
    startedAt: meta.startedAt,
    finishedAt: Date.now(),
    agentProvider: meta.agentProvider,
    agentModel: meta.agentModel,
  };

  await finalizeRecoveredRun(meta, events, result);
  console.log("[run:recovery] orphaned run cancelled", { runId: meta.runId });
  return true;
}

/** Resume tracking runs that were in-flight when the app last quit. */
export async function recoverOrphanedRuns(): Promise<void> {
  const runsDir = getRunsDir();
  const completed = new Set((await listRuns()).map((r) => r.runId));

  let files: string[];
  try {
    files = await fs.readdir(runsDir);
  } catch {
    return;
  }

  for (const file of files) {
    if (!file.endsWith(".meta.json")) continue;
    const runId = file.slice(0, -".meta.json".length);
    if (completed.has(runId)) {
      await deleteRunMeta(runId);
      await deleteRunPid(runId);
      continue;
    }
    if (_recovered.has(runId)) continue;

    const meta = await readRunMeta(runId);
    if (!meta) continue;

    console.log("[run:recovery] re-attaching orphaned run", {
      runId: meta.runId,
      storyName: meta.storyName,
    });
    await watchRecoveredRun(meta);
  }
}

async function watchRecoveredRun(meta: RunMeta): Promise<void> {
  const resultPath = path.join(getRunsDir(), `${meta.runId}.result.json`);
  const screenshotPath = getHeroScreenshotPath(meta.runId);

  const restored = await loadRecoverableRunEvents(meta.runId);
  const nextSeq = restored.reduce((max, e) => Math.max(max, e.seq), 0) + 1;
  const reconnectEvent: RunEvent = {
    runId: meta.runId,
    seq: nextSeq,
    ts: Date.now(),
    kind: "status",
    label: "Reconnected",
    detail: `Run resumed after app restart: ${meta.storyTitle}`,
    status: "running",
  };
  const events = [...restored, reconnectEvent];

  const pid = await readRunPid(meta.runId);
  const agentAlive = pid ? isProcessAlive(pid) : false;

  if (!agentAlive) {
    try {
      await fs.access(resultPath);
    } catch {
      console.log("[run:recovery] agent not running — finalizing interrupted run", {
        runId: meta.runId,
        pid,
      });
      const interrupted: RunResult = {
        runId: meta.runId,
        storyName: meta.storyName,
        storyTitle: meta.storyTitle,
        status: "cancelled",
        summary: "Interrupted when Story Studio restarted",
        assertions: [],
        screenshotPath,
        screenshotUrl: buildScreenshotUrl(meta.runId, screenshotPath),
        startedAt: meta.startedAt,
        finishedAt: Date.now(),
        error: "Agent process ended when the app closed",
        agentProvider: meta.agentProvider,
        agentModel: meta.agentModel,
      };
      await finalizeRecoveredRun(meta, events, interrupted);
      return;
    }
  }

  const pollTimer = setInterval(() => {
    void tryFinalizeRecoveredRun(meta, resultPath, screenshotPath, events, pollTimer);
  }, POLL_MS);

  _recovered.set(meta.runId, { meta, events, pollTimer });
  // Best-effort immediate check — the run may have finished while we were down.
  void tryFinalizeRecoveredRun(meta, resultPath, screenshotPath, events, pollTimer);
}

async function tryFinalizeRecoveredRun(
  meta: RunMeta,
  resultPath: string,
  screenshotPath: string,
  events: RunEvent[],
  pollTimer: ReturnType<typeof setInterval>,
): Promise<void> {
  let structured: Record<string, unknown> | null = null;
  try {
    const data = await fs.readFile(resultPath, "utf-8");
    structured = JSON.parse(data) as Record<string, unknown>;
  } catch {
    const pid = await readRunPid(meta.runId);
    if (pid && !isProcessAlive(pid)) {
      stopWatchingRecoveredRun(meta.runId);
      const interrupted: RunResult = {
        runId: meta.runId,
        storyName: meta.storyName,
        storyTitle: meta.storyTitle,
        status: "cancelled",
        summary: "Interrupted when Story Studio restarted",
        assertions: [],
        screenshotPath,
        screenshotUrl: buildScreenshotUrl(meta.runId, screenshotPath),
        startedAt: meta.startedAt,
        finishedAt: Date.now(),
        error: "Agent process ended while the run was in progress",
        agentProvider: meta.agentProvider,
        agentModel: meta.agentModel,
      };
      await finalizeRecoveredRun(meta, events, interrupted);
      console.log("[run:recovery] agent exited — finalized interrupted run", {
        runId: meta.runId,
      });
    }
    return;
  }

  // User may have cancelled while we were reading the result file.
  if (!_recovered.has(meta.runId)) return;

  stopWatchingRecoveredRun(meta.runId);

  const status = (structured["status"] as RunStatus | undefined) ?? "passed";
  const assertions = (structured["assertions"] as AssertionResult[] | undefined) ?? [];
  const summary = (structured["summary"] as string | undefined) ?? "";
  const lastSuccessfulStep = structured["lastSuccessfulStep"] as string | undefined;
  const finalScreenshotPath =
    (structured["screenshotPath"] as string | undefined) ?? screenshotPath;

  const result: RunResult = {
    runId: meta.runId,
    storyName: meta.storyName,
    storyTitle: meta.storyTitle,
    status,
    summary,
    assertions,
    screenshotPath: finalScreenshotPath,
    screenshotUrl: buildScreenshotUrl(meta.runId, finalScreenshotPath),
    lastSuccessfulStep,
    startedAt: meta.startedAt,
    finishedAt: Date.now(),
    agentProvider: meta.agentProvider,
    agentModel: meta.agentModel,
  };

  await finalizeRecoveredRun(meta, events, result);
  console.log("[run:recovery] orphaned run finalized", {
    runId: meta.runId,
    status: result.status,
  });
}
