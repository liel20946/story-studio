import type { AgentProvider } from "./contract-types.js";
import { startRun, cancelRun } from "./codex-runner.js";
import { startClaudeRun, cancelClaudeRun } from "./claude-runner.js";

const _runProviders = new Map<string, AgentProvider>();

export async function startAgentRun(
  provider: AgentProvider,
  runId: string,
  storyName: string,
  storyTitle: string,
  storyFilePath: string,
  agentBinary: string,
  runHook?: string,
) {
  _runProviders.set(runId, provider);
  if (provider === "claude-code") {
    return startClaudeRun(runId, storyName, storyTitle, storyFilePath, agentBinary, runHook);
  }
  return startRun(runId, storyName, storyTitle, storyFilePath, agentBinary, runHook);
}

export function cancelAgentRun(runId: string): boolean {
  const provider = _runProviders.get(runId);
  if (provider === "claude-code") {
    const cancelled = cancelClaudeRun(runId);
    if (cancelled) _runProviders.delete(runId);
    return cancelled;
  }
  const cancelled = cancelRun(runId);
  if (cancelled) _runProviders.delete(runId);
  return cancelled;
}

export function clearAgentRunProvider(runId: string): void {
  _runProviders.delete(runId);
}
