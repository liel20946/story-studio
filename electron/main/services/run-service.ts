import * as fs from "fs/promises";
import * as path from "path";
import type { RunRecord, RunResult } from "./contract-types.js";
import { getRunsDir } from "./paths.js";

const RUNS_FILE = () => path.join(getRunsDir(), "runs.json");

let _records: RunRecord[] = [];
let _loaded = false;

async function load(): Promise<void> {
  if (_loaded) return;
  try {
    const data = await fs.readFile(RUNS_FILE(), "utf-8");
    _records = JSON.parse(data) as RunRecord[];
  } catch {
    _records = [];
  }
  _loaded = true;
}

async function persist(): Promise<void> {
  await fs.writeFile(RUNS_FILE(), JSON.stringify(_records, null, 2), "utf-8");
}

export async function listRuns(): Promise<RunResult[]> {
  await load();
  // Return newest first, without events
  return _records
    .slice()
    .sort((a, b) => b.startedAt - a.startedAt)
    .map(({ events: _evts, ...result }) => result);
}

export async function getRun(runId: string): Promise<RunRecord> {
  await load();
  const record = _records.find((r) => r.runId === runId);
  if (!record) throw new Error(`Run not found: ${runId}`);
  return record;
}

// Serialize saves so concurrent runs (the bulk runner finishes several at once)
// can't race on the runs.json write — two overlapping writeFile calls could
// otherwise persist a stale snapshot and drop a record.
let _saveChain: Promise<void> = Promise.resolve();

export async function saveRun(record: RunRecord): Promise<void> {
  _saveChain = _saveChain
    .catch(() => {})
    .then(async () => {
      await load();
      const idx = _records.findIndex((r) => r.runId === record.runId);
      if (idx >= 0) {
        _records[idx] = record;
      } else {
        _records.push(record);
      }
      await persist();
    });
  return _saveChain;
}

/** Remove the on-disk artifacts (screenshot, result + schema JSON) for a run. */
async function removeRunFiles(runId: string): Promise<void> {
  const dir = getRunsDir();
  const files = [`${runId}.png`, `${runId}.result.json`, `${runId}.schema.json`];
  await Promise.all(
    files.map((f) =>
      fs.rm(path.join(dir, f), { force: true }).catch(() => {}),
    ),
  );
}

/** Delete a single run record and its artifacts. */
export async function deleteRun(runId: string): Promise<void> {
  await load();
  _records = _records.filter((r) => r.runId !== runId);
  await persist();
  await removeRunFiles(runId);
}

/** Delete all run history and artifacts. */
export async function clearRuns(): Promise<void> {
  await load();
  const ids = _records.map((r) => r.runId);
  _records = [];
  await persist();
  await Promise.all(ids.map((id) => removeRunFiles(id)));
}

/**
 * Update the stored storyTitle on every run record for a story, so run history
 * tracks a story rename. Returns true if any record changed.
 */
export async function renameRunsForStory(
  storyName: string,
  newTitle: string,
): Promise<boolean> {
  await load();
  let changed = false;
  for (const record of _records) {
    if (record.storyName === storyName && record.storyTitle !== newTitle) {
      record.storyTitle = newTitle;
      changed = true;
    }
  }
  if (changed) await persist();
  return changed;
}

/** Build a screenshotUrl for a given screenshot path. Returns undefined if no screenshot file. */
export function buildScreenshotUrl(_runId: string, screenshotPath: string | undefined): string | undefined {
  if (!screenshotPath) return undefined;
  return `story-screenshot://file?file=${encodeURIComponent(screenshotPath)}`;
}

/** Return a map of storyName -> lastRun for use in stories-service. */
export function buildLastRunMap(
  results: RunResult[],
): Map<string, { status: import("./contract-types.js").RunStatus; finishedAt: number }> {
  const map = new Map<string, { status: import("./contract-types.js").RunStatus; finishedAt: number }>();
  // results are newest-first; we want the newest per story
  for (const r of results) {
    if (!map.has(r.storyName)) {
      map.set(r.storyName, { status: r.status, finishedAt: r.finishedAt });
    }
  }
  return map;
}
