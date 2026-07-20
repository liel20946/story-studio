import { broadcast } from "../broadcast.js";
import { buildScreenshotUrl, saveRun } from "./run-service.js";
import { ensureRunOutputDir, getHeroScreenshotPath } from "./run-artifacts.js";
import { writeRunMeta, deleteRunMeta, withRunVariables } from "./run-meta.js";
import type {
  ActiveRunSnapshot,
  AgentProvider,
  RunEvent,
  RunResult,
} from "./contract-types.js";

/**
 * When STORY_STUDIO_MOCK_RUNS=1, story runs finish locally without spawning an
 * agent CLI. Used for UI demos and screenshot capture.
 */
export function mockRunsEnabled(): boolean {
  return (
    process.env.STORY_STUDIO_MOCK_RUNS === "1" ||
    process.env.STORY_STUDIO_MOCK_RUNS === "true"
  );
}

interface MockRunState {
  runId: string;
  storyName: string;
  storyTitle: string;
  startedAt: number;
  agentProvider: AgentProvider;
  agentModel: string;
  events: RunEvent[];
  cancelled: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  resolve: ((result: RunResult) => void) | null;
  variableOverrides?: Record<string, string>;
}

const _mocks = new Map<string, MockRunState>();

function decideStatus(storyName: string, storyTitle: string): RunResult["status"] {
  const hay = `${storyName} ${storyTitle}`.toLowerCase();
  if (hay.includes("fail") || hay.includes("checkout") || hay.includes("broken")) {
    return "failed";
  }
  return "passed";
}

export async function startMockRun(
  provider: AgentProvider,
  runId: string,
  storyName: string,
  storyTitle: string,
  agentModel = "mock",
  variableOverrides?: Record<string, string>,
): Promise<RunResult> {
  const startedAt = Date.now();
  await ensureRunOutputDir(runId);
  await writeRunMeta({
    runId,
    storyName,
    storyTitle,
    startedAt,
    agentProvider: provider,
    agentModel,
    variableOverrides,
  });

  const state: MockRunState = {
    runId,
    storyName,
    storyTitle,
    startedAt,
    agentProvider: provider,
    agentModel,
    events: [],
    cancelled: false,
    timer: null,
    resolve: null,
    variableOverrides,
  };
  _mocks.set(runId, state);

  const push = (partial: Omit<RunEvent, "runId" | "seq" | "ts">) => {
    const evt: RunEvent = {
      runId,
      seq: state.events.length + 1,
      ts: Date.now(),
      ...partial,
    };
    state.events.push(evt);
    broadcast("run:event", evt);
  };

  push({
    kind: "status",
    label: "Starting",
    detail: `Mock run for ${storyTitle}`,
    status: "running",
  });

  return new Promise<RunResult>((resolve) => {
    state.resolve = resolve;
    // Stagger so some stories finish before others — makes stop/resume demos clear.
    const delay = 1400 + Math.floor(Math.random() * 900);
    state.timer = setTimeout(() => {
      void finishMockRun(runId);
    }, delay);
  });
}

async function finishMockRun(runId: string): Promise<void> {
  const state = _mocks.get(runId);
  if (!state || !state.resolve) return;

  const screenshotPath = getHeroScreenshotPath(runId);
  const status = state.cancelled
    ? "cancelled"
    : decideStatus(state.storyName, state.storyTitle);

  const summary =
    status === "passed"
      ? `Mock run passed for ${state.storyTitle}`
      : status === "cancelled"
        ? "Cancelled"
        : `Mock run failed for ${state.storyTitle}`;

  const endEvent: RunEvent = {
    runId,
    seq: state.events.length + 1,
    ts: Date.now(),
    kind: "status",
    label: status === "passed" ? "Passed" : status === "cancelled" ? "Cancelled" : "Failed",
    detail: summary,
    status: status === "passed" ? "ok" : status === "cancelled" ? "cancelled" : "failed",
  };
  state.events.push(endEvent);
  broadcast("run:event", endEvent);

  const result: RunResult = {
    runId,
    storyName: state.storyName,
    storyTitle: state.storyTitle,
    status,
    summary,
    assertions:
      status === "passed"
        ? [{ text: "Mock assertion", passed: true }]
        : [{ text: "Mock assertion", passed: false, evidence: "Simulated failure" }],
    screenshotPath,
    screenshotUrl: buildScreenshotUrl(runId, screenshotPath),
    startedAt: state.startedAt,
    finishedAt: Date.now(),
    error: status === "failed" ? summary : undefined,
    agentProvider: state.agentProvider,
    agentModel: state.agentModel,
  };

  const withVars = await withRunVariables(result);
  await saveRun({ ...withVars, events: state.events });
  broadcast("run:result", withVars);
  await deleteRunMeta(runId).catch(() => undefined);

  const resolve = state.resolve;
  state.resolve = null;
  state.timer = null;
  _mocks.delete(runId);
  resolve(withVars);
}

export function cancelMockRun(runId: string): boolean {
  const state = _mocks.get(runId);
  if (!state) return false;
  state.cancelled = true;
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  void finishMockRun(runId);
  return true;
}

export function listActiveMockRuns(): ActiveRunSnapshot[] {
  return Array.from(_mocks.values()).map((s) => ({
    runId: s.runId,
    storyName: s.storyName,
    storyTitle: s.storyTitle,
    startedAt: s.startedAt,
    events: s.events,
    agentProvider: s.agentProvider,
    agentModel: s.agentModel,
    variableOverrides: s.variableOverrides,
  }));
}
