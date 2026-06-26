import * as fs from "fs/promises";
import * as path from "path";
import type { RunEvent, RunEventKind } from "./contract-types.js";
import type { RunStep } from "./contract-types.js";
import { getRunOutputDir, loadRunSteps } from "./run-artifacts.js";
import { getRunsDir } from "./paths.js";

export function getRunEventsPath(runId: string): string {
  return path.join(getRunOutputDir(runId), "events.json");
}

export function getRunPidPath(runId: string): string {
  return path.join(getRunsDir(), `${runId}.pid`);
}

const _persistTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Debounced write of the live timeline so it survives app restart. */
export function schedulePersistRunEvents(runId: string, events: RunEvent[]): void {
  const existing = _persistTimers.get(runId);
  if (existing) clearTimeout(existing);
  _persistTimers.set(
    runId,
    setTimeout(() => {
      _persistTimers.delete(runId);
      void persistRunEvents(runId, events);
    }, 250),
  );
}

export async function flushPersistRunEvents(runId: string, events: RunEvent[]): Promise<void> {
  const existing = _persistTimers.get(runId);
  if (existing) {
    clearTimeout(existing);
    _persistTimers.delete(runId);
  }
  await persistRunEvents(runId, events);
}

export async function persistRunEvents(runId: string, events: RunEvent[]): Promise<void> {
  try {
    const dir = getRunOutputDir(runId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(getRunEventsPath(runId), JSON.stringify(events), "utf-8");
  } catch (err) {
    console.warn("[run:events] persist failed", { runId, err });
  }
}

export async function loadPersistedRunEvents(runId: string): Promise<RunEvent[]> {
  try {
    const raw = await fs.readFile(getRunEventsPath(runId), "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as RunEvent[];
  } catch {
    return [];
  }
}

export async function deletePersistedRunEvents(runId: string): Promise<void> {
  await fs.rm(getRunEventsPath(runId), { force: true }).catch(() => {});
}

export async function writeRunPid(runId: string, pid: number): Promise<void> {
  await fs.writeFile(getRunPidPath(runId), String(pid), "utf-8");
}

export async function readRunPid(runId: string): Promise<number | null> {
  try {
    const n = Number.parseInt(await fs.readFile(getRunPidPath(runId), "utf-8"), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export async function deleteRunPid(runId: string): Promise<void> {
  await fs.rm(getRunPidPath(runId), { force: true }).catch(() => {});
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function stepTextToKind(text: string): RunEventKind {
  if (/^Navigate\b/i.test(text)) return "navigate";
  if (/^Click\b/i.test(text)) return "click";
  if (/^Fill\b/i.test(text)) return "type";
  if (/^Press\b/i.test(text)) return "click";
  if (/^Select\b/i.test(text)) return "click";
  if (/^Verify\b/i.test(text)) return "snapshot";
  if (/^Wait\b/i.test(text)) return "wait";
  return "tool";
}

function stepTextToLabel(text: string): string {
  const kind = stepTextToKind(text);
  if (kind === "navigate") return "Navigate";
  if (kind === "click") return "Click";
  if (kind === "type") return "Fill";
  if (kind === "snapshot") return "Verify";
  if (kind === "wait") return "Wait";
  return "Step";
}

function stepTextToDetail(text: string): string {
  const stripped = text
    .replace(/^Navigate to\s+/i, "")
    .replace(/^Click (?:the\s+)?/i, "")
    .replace(/^Fill (?:the\s+)?/i, "")
    .replace(/^Press\s+/i, "")
    .replace(/^Select\s+/i, "")
    .replace(/^Verify\s+/i, "");
  return stripped.trim() || text;
}

/** Rebuild a coarse action timeline from steps.json when events.json is missing. */
export function runEventsFromSteps(runId: string, steps: RunStep[]): RunEvent[] {
  return steps.map((step, index) => {
    const ts = step.startedAt ? Date.parse(step.startedAt) : Date.now();
    const status =
      step.status === "passed"
        ? ("ok" as const)
        : step.status === "failed"
          ? ("failed" as const)
          : ("cancelled" as const);
    return {
      runId,
      seq: index + 1,
      ts: Number.isFinite(ts) ? ts : Date.now(),
      kind: stepTextToKind(step.text),
      label: stepTextToLabel(step.text),
      detail: stepTextToDetail(step.text),
      status,
    };
  });
}

/** Load persisted timeline events, falling back to steps.json for older runs. */
export async function loadRecoverableRunEvents(runId: string): Promise<RunEvent[]> {
  const persisted = await loadPersistedRunEvents(runId);
  if (persisted.length > 0) return persisted;

  const steps = await loadRunSteps(runId);
  if (steps.length > 0) return runEventsFromSteps(runId, steps);

  return [];
}
