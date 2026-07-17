import * as path from "path";
import type { RunEvent, RunStep } from "./contract-types.js";
import { listActiveRuns } from "./agent-runner.js";
import {
  ensureActionTimelineFromSteps,
  loadPersistedRunEvents,
  runEventsFromSteps,
} from "./run-events-persist.js";
import { collectLiveScreenshotPaths, loadRunSteps } from "./run-artifacts.js";

function slugToStepText(slug: string): string {
  const words = slug.split("-");
  const verb = words[0]?.toLowerCase() ?? "";
  if (verb === "navigate" && words[1] === "to") {
    return `Navigate to ${words.slice(2).join(" ")}`;
  }
  if (
    verb === "navigate" ||
    verb === "click" ||
    verb === "fill" ||
    verb === "press" ||
    verb === "select" ||
    verb === "verify" ||
    verb === "wait"
  ) {
    const label = verb.charAt(0).toUpperCase() + verb.slice(1);
    return `${label} ${words.slice(1).join(" ")}`.trim();
  }
  // Checkpoint slug — keep hyphenated form for keyword inference in stepTextToKind.
  return slug.replace(/-/g, " ");
}

/** Infer checkpoint actions from live screenshot filenames (step-N-slug.png). */
export function runEventsFromScreenshotPaths(
  runId: string,
  paths: string[],
): RunEvent[] {
  const events: RunEvent[] = [];
  for (const fullPath of paths) {
    const base = path.basename(fullPath, ".png");
    const match = base.match(/^step-(\d+)-(.+)$/i);
    if (!match) continue;
    const index = Number.parseInt(match[1], 10);
    const text = slugToStepText(match[2]);
    const fromSteps = runEventsFromSteps(runId, [
      {
        index,
        text,
        status: "passed",
        startedAt: undefined,
        finishedAt: undefined,
        screenshot: fullPath,
        error: null,
      },
    ]);
    if (fromSteps[0]) {
      events.push({ ...fromSteps[0], seq: index });
    }
  }
  events.sort((a, b) => a.seq - b.seq);
  return events;
}

function mergeEventsBySeq(a: RunEvent[], b: RunEvent[]): RunEvent[] {
  const bySeq = new Map<number, RunEvent>();
  for (const e of [...a, ...b]) bySeq.set(e.seq, e);
  return Array.from(bySeq.values()).sort((x, y) => x.seq - y.seq);
}

function isActionEvent(event: RunEvent): boolean {
  return (
    event.kind === "navigate" ||
    event.kind === "click" ||
    event.kind === "type" ||
    event.kind === "snapshot" ||
    event.kind === "screenshot" ||
    event.kind === "wait"
  );
}

/** Best-effort live timeline for an in-flight run (MCP stream + screenshots + steps). */
export async function buildLiveTimeline(runId: string): Promise<RunEvent[]> {
  const snap = listActiveRuns().find((s) => s.runId === runId);
  let events = snap?.events ?? [];

  const persisted = await loadPersistedRunEvents(runId);
  if (persisted.length > events.length) events = persisted;

  // Checkpoint PNGs land on disk while the script runs — always merge them in
  // so actions appear live even when Codex only emits shell/setup rows.
  const shotPaths = await collectLiveScreenshotPaths(runId);
  const fromShots = runEventsFromScreenshotPaths(runId, shotPaths);
  if (fromShots.length > 0) {
    events = mergeEventsBySeq(events, fromShots);
  }

  const steps = await loadRunSteps(runId);
  if (steps.length > 0) {
    events = ensureActionTimelineFromSteps(runId, events, steps);
  }

  if (events.some(isActionEvent)) {
    events = events.filter((e) => e.kind === "status" || isActionEvent(e));
  }

  return events;
}

// Re-export for callers that already import from run-timeline.
export {
  ensureActionTimeline,
  ensureActionTimelineFromSteps,
  hasActionTimelineEvents,
} from "./run-events-persist.js";
