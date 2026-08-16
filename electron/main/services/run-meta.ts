import * as fs from "fs/promises";
import * as path from "path";
import { getRunsDir } from "./paths.js";

import type { AgentProvider, RunResult } from "./contract-types.js";

export interface RunMeta {
  runId: string;
  storyName: string;
  storyTitle: string;
  startedAt: number;
  agentProvider?: AgentProvider;
  agentModel?: string;
  /** Effective variable values used for this run (for retry). */
  variableOverrides?: Record<string, string>;
  /** Codex thread id / Claude conversation id — kept here so history can Open in. */
  providerSessionId?: string;
}

/** Attach persisted run fields from meta onto a result before saving. */
export async function withRunVariables(result: RunResult): Promise<RunResult> {
  const meta = await readRunMeta(result.runId);
  if (!meta) return result;

  let next = result;
  if (meta.variableOverrides && Object.keys(meta.variableOverrides).length > 0) {
    next = { ...next, variableOverrides: meta.variableOverrides };
  }
  // Prefer the streamed result id; fall back to meta so cancelled/failed runs
  // still keep Open in after the live process is gone.
  if (!next.providerSessionId?.trim() && meta.providerSessionId?.trim()) {
    next = { ...next, providerSessionId: meta.providerSessionId.trim() };
  }
  return next;
}

export function getRunMetaPath(runId: string): string {
  return path.join(getRunsDir(), `${runId}.meta.json`);
}

export async function writeRunMeta(meta: RunMeta): Promise<void> {
  await fs.writeFile(getRunMetaPath(meta.runId), JSON.stringify(meta), "utf-8");
}

/** Persist a newly discovered provider conversation id onto the in-flight meta. */
export async function patchRunMetaProviderSession(
  runId: string,
  providerSessionId: string,
): Promise<void> {
  const trimmed = providerSessionId.trim();
  if (!trimmed) return;
  const meta = await readRunMeta(runId);
  if (!meta) return;
  if (meta.providerSessionId === trimmed) return;
  await writeRunMeta({ ...meta, providerSessionId: trimmed });
}

export async function readRunMeta(runId: string): Promise<RunMeta | null> {
  try {
    const data = await fs.readFile(getRunMetaPath(runId), "utf-8");
    return JSON.parse(data) as RunMeta;
  } catch {
    return null;
  }
}

export async function deleteRunMeta(runId: string): Promise<void> {
  await fs.rm(getRunMetaPath(runId), { force: true }).catch(() => {});
}
