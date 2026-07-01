import * as fs from "fs/promises";
import * as path from "path";
import type { RunStep } from "./contract-types.js";
import { getRunsDir } from "./paths.js";
import { readRunMeta } from "./run-meta.js";

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

/** Resolve agent-written relative artifact paths against the run output directory. */
export function resolveRunArtifactPath(runId: string, artifactPath: string): string {
  if (path.isAbsolute(artifactPath)) return artifactPath;
  return path.join(getRunOutputDir(runId), artifactPath);
}

export async function loadRunSteps(runId: string): Promise<RunStep[]> {
  try {
    const raw = await fs.readFile(getRunStepsPath(runId), "utf-8");
    const parsed = JSON.parse(raw) as Array<Record<string, unknown>>;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((step) => {
      const screenshot = step["screenshot"];
      const screenshotPath =
        typeof screenshot === "string"
          ? resolveRunArtifactPath(runId, screenshot)
          : (screenshot as string | null | undefined);
      return {
        index: Number(step["index"] ?? 0),
        text: String(step["text"] ?? ""),
        status: (step["status"] as RunStep["status"]) ?? "passed",
        startedAt:
          (step["startedAt"] as string | undefined) ??
          (step["started_at"] as string | undefined),
        finishedAt:
          (step["finishedAt"] as string | undefined) ??
          (step["finished_at"] as string | undefined),
        screenshot: screenshotPath ?? null,
        error: (step["error"] as string | null | undefined) ?? null,
      };
    });
  } catch {
    return [];
  }
}

export async function collectScreenshotPaths(runId: string): Promise<string[]> {
  const checkpoints = await collectPngPathsByMtime(getRunScreenshotsDir(runId));
  const hero = getHeroScreenshotPath(runId);
  try {
    await fs.access(hero);
    if (!checkpoints.includes(hero)) {
      return [...checkpoints, hero];
    }
  } catch {
    // hero not written yet
  }
  return checkpoints;
}

async function collectPngPathsByMtime(dir: string): Promise<string[]> {
  try {
    const files = await fs.readdir(dir);
    const pngs = files.filter((f) => f.endsWith(".png"));
    const withMtime = await Promise.all(
      pngs.map(async (f) => {
        const full = path.join(dir, f);
        const stat = await fs.stat(full);
        return { full, mtime: stat.mtimeMs };
      }),
    );
    withMtime.sort((a, b) => a.mtime - b.mtime);
    return withMtime.map(({ full }) => full);
  } catch {
    return [];
  }
}

async function collectPngPathsSince(dir: string, sinceMs: number): Promise<string[]> {
  const paths = await collectPngPathsByMtime(dir);
  if (paths.length === 0 || sinceMs <= 0) return paths;
  const filtered: string[] = [];
  for (const full of paths) {
    try {
      const stat = await fs.stat(full);
      if (stat.mtimeMs >= sinceMs - 5_000) filtered.push(full);
    } catch {
      // skip missing files
    }
  }
  return filtered;
}

/** Screenshot paths written so far during an in-flight run. */
export async function collectLiveScreenshotPaths(runId: string): Promise<string[]> {
  // Checkpoint PNGs land in screenshots/ long before steps.json is written at run end.
  const fromDir = await collectScreenshotPaths(runId);
  if (fromDir.length > 0) return fromDir;

  // Back-compat: when the agent cwd was the runs root, Playwright wrote to runs/screenshots/.
  const meta = await readRunMeta(runId);
  if (meta) {
    const legacyDir = path.join(getRunsDir(), "screenshots");
    const legacy = await collectPngPathsSince(legacyDir, meta.startedAt);
    if (legacy.length > 0) return legacy;
  }

  const steps = await loadRunSteps(runId);
  const fromSteps = steps
    .map((step) => step.screenshot)
    .filter((screenshot): screenshot is string => !!screenshot);
  if (fromSteps.length > 0) return fromSteps;

  const hero = getHeroScreenshotPath(runId);
  try {
    await fs.access(hero);
    return [hero];
  } catch {
    return [];
  }
}

export async function enrichRunResult<T extends { runId: string; screenshotPath?: string }>(
  result: T,
): Promise<T & { steps?: RunStep[]; screenshotPaths?: string[] }> {
  const steps = await loadRunSteps(result.runId);
  const screenshotPaths = await collectScreenshotPaths(result.runId);
  const screenshotPath =
    result.screenshotPath && !path.isAbsolute(result.screenshotPath)
      ? resolveRunArtifactPath(result.runId, result.screenshotPath)
      : result.screenshotPath;
  if (steps.length === 0 && !screenshotPath) {
    const legacy = path.join(getRunsDir(), `${result.runId}.png`);
    try {
      await fs.access(legacy);
      return { ...result, screenshotPath: legacy, steps, screenshotPaths };
    } catch {
      return { ...result, steps, screenshotPaths };
    }
  }
  return { ...result, screenshotPath, steps, screenshotPaths };
}
