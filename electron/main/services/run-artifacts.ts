import * as fs from "fs/promises";
import * as path from "path";
import type { RunStep } from "./contract-types.js";
import { getRunsDir } from "./paths.js";

export function getRunOutputDir(runId: string): string {
  return path.join(getRunsDir(), runId);
}

export function getRunScreenshotsDir(runId: string): string {
  return path.join(getRunOutputDir(runId), "screenshots");
}

export function getRunStepsPath(runId: string): string {
  return path.join(getRunOutputDir(runId), "steps.json");
}

export function getHeroScreenshotPath(runId: string): string {
  return path.join(getRunOutputDir(runId), "hero.png");
}

export async function ensureRunOutputDir(runId: string): Promise<string> {
  const dir = getRunOutputDir(runId);
  await fs.mkdir(path.join(dir, "screenshots"), { recursive: true });
  return dir;
}

export async function loadRunSteps(runId: string): Promise<RunStep[]> {
  try {
    const raw = await fs.readFile(getRunStepsPath(runId), "utf-8");
    const parsed = JSON.parse(raw) as RunStep[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function collectScreenshotPaths(runId: string): Promise<string[]> {
  const dir = getRunScreenshotsDir(runId);
  try {
    const files = await fs.readdir(dir);
    return files
      .filter((f) => f.endsWith(".png"))
      .sort()
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

export async function enrichRunResult<T extends { runId: string; screenshotPath?: string }>(
  result: T,
): Promise<T & { steps?: RunStep[]; screenshotPaths?: string[] }> {
  const steps = await loadRunSteps(result.runId);
  const screenshotPaths = await collectScreenshotPaths(result.runId);
  if (steps.length === 0 && !result.screenshotPath) {
    const legacy = path.join(getRunsDir(), `${result.runId}.png`);
    try {
      await fs.access(legacy);
      return { ...result, screenshotPath: legacy, steps, screenshotPaths };
    } catch {
      return { ...result, steps, screenshotPaths };
    }
  }
  return { ...result, steps, screenshotPaths };
}
