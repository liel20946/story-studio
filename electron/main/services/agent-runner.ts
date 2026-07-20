import type { AgentProvider, ActiveRunSnapshot, RunResult } from "./contract-types.js";
import type { AgentRunConfig } from "./agent-config.js";
import { startRun, cancelRun, listActiveCodexRuns } from "./codex-runner.js";
import { startClaudeRun, cancelClaudeRun, listActiveClaudeRuns } from "./claude-runner.js";
import { cancelRecoveredRun, isRecoveredRun, listRecoveredRuns } from "./run-recovery.js";
import {
  cancelMockRun,
  listActiveMockRuns,
  mockRunsEnabled,
  startMockRun,
} from "./mock-runner.js";

const _runProviders = new Map<string, AgentProvider>();

export async function startAgentRun(
  provider: AgentProvider,
  runId: string,
  storyName: string,
  storyTitle: string,
  storyFilePath: string,
  agentBinary: string,
  runHook?: string,
  agentConfig?: AgentRunConfig,
  variableOverrides?: Record<string, string>,
): Promise<RunResult> {
  _runProviders.set(runId, provider);
  if (mockRunsEnabled()) {
    return startMockRun(
      provider,
      runId,
      storyName,
      storyTitle,
      agentConfig?.model ?? "mock",
      variableOverrides,
    );
  }
  if (provider === "claude-code") {
    return startClaudeRun(
      runId,
      storyName,
      storyTitle,
      storyFilePath,
      agentBinary,
      runHook,
      agentConfig,
      variableOverrides,
    );
  }
  return startRun(
    runId,
    storyName,
    storyTitle,
    storyFilePath,
    agentBinary,
    runHook,
    agentConfig,
    variableOverrides,
  );
}

export async function cancelAgentRun(runId: string): Promise<boolean> {
  if (mockRunsEnabled() && cancelMockRun(runId)) {
    _runProviders.delete(runId);
    return true;
  }

  if (isRecoveredRun(runId)) {
    return cancelRecoveredRun(runId);
  }

  const provider = _runProviders.get(runId);
  if (provider === "claude-code") {
    const cancelled = cancelClaudeRun(runId);
    if (cancelled) {
      _runProviders.delete(runId);
      return true;
    }
  } else {
    const cancelled = cancelRun(runId);
    if (cancelled) {
      _runProviders.delete(runId);
      return true;
    }
  }
  return cancelRecoveredRun(runId);
}

export function clearAgentRunProvider(runId: string): void {
  _runProviders.delete(runId);
}

/** In-flight runs across all runners — used to hydrate the renderer after reload. */
export function listActiveRuns(): ActiveRunSnapshot[] {
  const byId = new Map<string, ActiveRunSnapshot>();
  for (const snap of [
    ...listActiveMockRuns(),
    ...listActiveCodexRuns(),
    ...listActiveClaudeRuns(),
    ...listRecoveredRuns(),
  ]) {
    byId.set(snap.runId, snap);
  }
  return Array.from(byId.values());
}
