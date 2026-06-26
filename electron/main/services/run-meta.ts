import * as fs from "fs/promises";
import * as path from "path";
import { getRunsDir } from "./paths.js";

import type { AgentProvider } from "./contract-types.js";

export interface RunMeta {
  runId: string;
  storyName: string;
  storyTitle: string;
  startedAt: number;
  agentProvider?: AgentProvider;
  agentModel?: string;
}

export function getRunMetaPath(runId: string): string {
  return path.join(getRunsDir(), `${runId}.meta.json`);
}

export async function writeRunMeta(meta: RunMeta): Promise<void> {
  await fs.writeFile(getRunMetaPath(meta.runId), JSON.stringify(meta), "utf-8");
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
