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

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Resolve a step screenshot path, including legacy run-root checkpoint files. */
export async function resolveStepScreenshotPath(
  runId: string,
  screenshotPath: string,
): Promise<string | null> {
  const direct = resolveRunArtifactPath(runId, screenshotPath);
  if (await fileExists(direct)) return direct;

  const basename = path.basename(screenshotPath);
  const runRoot = path.join(getRunOutputDir(runId), basename);
  if (await fileExists(runRoot)) return runRoot;

  const screenshotsDir = path.join(getRunScreenshotsDir(runId), basename);
  if (await fileExists(screenshotsDir)) return screenshotsDir;

  return null;
}

export async function loadRunSteps(runId: string): Promise<RunStep[]> {
  try {
    const raw = await fs.readFile(getRunStepsPath(runId), "utf-8");
    const parsed = JSON.parse(raw) as Array<Record<string, unknown>>;
    if (!Array.isArray(parsed)) return [];
    const steps: RunStep[] = [];
    for (const step of parsed) {
      const screenshot = step["screenshot"];
      let screenshotPath: string | null = null;
      if (typeof screenshot === "string" && screenshot.trim().length > 0) {
        screenshotPath = await resolveStepScreenshotPath(runId, screenshot);
      }
      steps.push({
        index: Number(step["index"] ?? 0),
        text: String(step["text"] ?? ""),
        status: (step["status"] as RunStep["status"]) ?? "passed",
        startedAt:
          (step["startedAt"] as string | undefined) ??
          (step["started_at"] as string | undefined),
        finishedAt:
          (step["finishedAt"] as string | undefined) ??
          (step["finished_at"] as string | undefined),
        screenshot: screenshotPath,
        error: (step["error"] as string | null | undefined) ?? null,
      });
    }
    return steps;
  } catch {
    return [];
  }
}

const SCREENSHOT_EXTENSIONS = new Set([".png", ".jpeg", ".jpg", ".webp"]);

async function collectImagePathsByMtime(dir: string): Promise<string[]> {
  try {
    const files = await fs.readdir(dir);
    const images = files.filter((file) =>
      SCREENSHOT_EXTENSIONS.has(path.extname(file).toLowerCase()),
    );
    const withMtime = await Promise.all(
      images.map(async (f) => {
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

function dedupePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const full of paths) {
    const key = path.resolve(full);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(full);
  }
  return out;
}

async function collectRunCheckpointImages(runId: string): Promise<string[]> {
  const runRoot = getRunOutputDir(runId);
  const screenshotsDir = getRunScreenshotsDir(runId);
  const fromScreenshots = await collectImagePathsByMtime(screenshotsDir);
  const fromRoot = await collectImagePathsByMtime(runRoot);
  const checkpointRoot = fromRoot.filter((full) => {
    const base = path.basename(full).toLowerCase();
    return base.startsWith("step-") || base === "hero.png";
  });
  return dedupePaths([...fromScreenshots, ...checkpointRoot]);
}

export async function collectScreenshotPaths(runId: string): Promise<string[]> {
  return collectRunCheckpointImages(runId);
}

async function collectImagePathsSince(dir: string, sinceMs: number): Promise<string[]> {
  const paths = await collectImagePathsByMtime(dir);
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
  const fromDirs = await collectRunCheckpointImages(runId);
  if (fromDirs.length > 0) return fromDirs;

  // Back-compat: when the agent cwd was the runs root, Playwright wrote to runs/screenshots/.
  const meta = await readRunMeta(runId);
  if (meta) {
    const legacyDir = path.join(getRunsDir(), "screenshots");
    const legacy = await collectImagePathsSince(legacyDir, meta.startedAt);
    if (legacy.length > 0) return legacy;
  }

  const steps = await loadRunSteps(runId);
  const fromSteps = steps
    .map((step) => step.screenshot)
    .filter((screenshot): screenshot is string => !!screenshot);
  if (fromSteps.length > 0) return fromSteps;

  const hero = getHeroScreenshotPath(runId);
  if (await fileExists(hero)) return [hero];
  return [];
}

export async function enrichRunResult<T extends { runId: string; screenshotPath?: string }>(
  result: T,
): Promise<T & { steps?: RunStep[]; screenshotPaths?: string[] }> {
  const steps = await loadRunSteps(result.runId);
  const screenshotPaths = await collectScreenshotPaths(result.runId);
  let screenshotPath =
    result.screenshotPath && !path.isAbsolute(result.screenshotPath)
      ? resolveRunArtifactPath(result.runId, result.screenshotPath)
      : result.screenshotPath;
  if (screenshotPath && !(await fileExists(screenshotPath))) {
    const resolved = await resolveStepScreenshotPath(result.runId, screenshotPath);
    screenshotPath = resolved ?? undefined;
  }
  if (steps.length === 0 && !screenshotPath) {
    const legacy = path.join(getRunsDir(), `${result.runId}.png`);
    if (await fileExists(legacy)) {
      return { ...result, screenshotPath: legacy, steps, screenshotPaths };
    }
    return { ...result, steps, screenshotPaths };
  }
  return { ...result, screenshotPath, steps, screenshotPaths };
}
