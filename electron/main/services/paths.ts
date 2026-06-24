import * as fs from "fs/promises";
import * as path from "path";
import { app } from "../electron-api.js";

let _storiesDir: string | null = null;
let _runsDir: string | null = null;
let _draftsDir: string | null = null;
let _generateDir: string | null = null;

export function getStoriesDir(): string {
  if (!_storiesDir) throw new Error("paths not initialized — call initPaths() first");
  return _storiesDir;
}

export function getRunsDir(): string {
  if (!_runsDir) throw new Error("paths not initialized — call initPaths() first");
  return _runsDir;
}

export function getDraftsDir(): string {
  if (!_draftsDir) throw new Error("paths not initialized — call initPaths() first");
  return _draftsDir;
}

export function getGenerateDir(): string {
  if (!_generateDir) throw new Error("paths not initialized — call initPaths() first");
  return _generateDir;
}

export async function initPaths(overrides?: {
  storiesDir?: string | null;
  runsDir?: string | null;
}): Promise<void> {
  const userData = app.getPath("userData");
  _storiesDir = overrides?.storiesDir ?? path.join(userData, "stories");
  _runsDir = overrides?.runsDir ?? path.join(userData, "runs");
  _draftsDir = path.join(userData, "drafts");
  _generateDir = path.join(userData, "generate-sessions");
  await fs.mkdir(_storiesDir, { recursive: true });
  await fs.mkdir(_runsDir, { recursive: true });
  await fs.mkdir(_draftsDir, { recursive: true });
  await fs.mkdir(_generateDir, { recursive: true });
}

export function overridePaths(opts: { storiesDir?: string; runsDir?: string }): void {
  if (opts.storiesDir) _storiesDir = opts.storiesDir;
  if (opts.runsDir) _runsDir = opts.runsDir;
}
