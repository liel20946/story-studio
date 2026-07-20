import type { RunEvent } from "./contract-types";

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

/** Codex startup stderr that older builds surfaced as a failed timeline row. */
export function isBenignCodexStderrEvent(event: RunEvent): boolean {
  if (event.kind !== "error" || !event.detail) return false;
  const trimmed = stripAnsi(event.detail).trim();
  return /reading additional input from stdin/i.test(trimmed);
}

/** Agent reasoning / browser_evaluate rows — hidden from the action timeline. */
export function isThinkingEvent(event: RunEvent): boolean {
  return event.kind === "reasoning" || event.kind === "evaluate";
}

/** Internal agent tooling rows (Write/Bash/etc.) — hidden from the action timeline. */
export function isInternalToolEvent(event: RunEvent): boolean {
  return event.kind === "tool";
}

/** Startup / reconnect / cancel meta rows — not browser actions. */
export function isMetaStatusEvent(event: RunEvent): boolean {
  return event.kind === "status";
}

/** Codex shell / setup / script rows — not browser actions. */
export function isShellSetupEvent(event: RunEvent): boolean {
  if (event.kind !== "message") return false;
  const label = event.label ?? "";
  return (
    label === "Shell" ||
    label === "Setup" ||
    label === "Running story" ||
    label === "Agent"
  );
}

/** Browser checkpoint rows (Navigate / Click / Fill / Verify / …). */
export function isActionEvent(event: RunEvent): boolean {
  return (
    event.kind === "navigate" ||
    event.kind === "click" ||
    event.kind === "type" ||
    event.kind === "snapshot" ||
    event.kind === "screenshot" ||
    event.kind === "wait"
  );
}

/** Delays are implementation details, not useful user-facing actions. */
export function isWaitEvent(event: RunEvent): boolean {
  return event.kind === "wait";
}

export function hasActionTimelineEvents(events: RunEvent[]): boolean {
  return events.some(isActionEvent);
}

export function filterTimelineEvents(events: RunEvent[]): RunEvent[] {
  return events.filter(
    (e) =>
      !isBenignCodexStderrEvent(e) &&
      !isThinkingEvent(e) &&
      !isInternalToolEvent(e) &&
      !isMetaStatusEvent(e) &&
      !isShellSetupEvent(e) &&
      !isWaitEvent(e),
  );
}

/**
 * Prefer the polled live timeline (buildLiveTimeline / steps.json) whenever it
 * already has browser actions. That source is canonical and stable; comparing
 * raw action counts against the MCP stream caused the UI to flip mid-run
 * between sparse tool rows and human-readable story steps.
 */
export function pickLiveTimelineEvents(
  storeEvents: RunEvent[],
  polledEvents: RunEvent[],
  isFinished: boolean,
): RunEvent[] {
  const store = filterTimelineEvents(storeEvents);
  const polled = filterTimelineEvents(polledEvents);

  if (polled.some(isActionEvent)) return polled;
  if (store.some(isActionEvent)) return store;

  // Finished records are also canonicalized from steps.json. Do not retain a
  // sparse live MCP timeline merely because it contains one event.
  if (isFinished && polled.length > 0) return polled;
  return polled.length > 0 ? polled : store;
}

/** Best-effort story title from codex/claude "Starting" / "Reconnected" status rows. */
export function metadataFromRunEvents(events: RunEvent[]): {
  storyTitle?: string;
} {
  for (const ev of events) {
    if (ev.kind !== "status" || !ev.detail) continue;
    const match =
      ev.detail.match(/for story:\s*(.+)$/i) ??
      ev.detail.match(/after app restart:\s*(.+)$/i);
    if (match?.[1]) return { storyTitle: match[1].trim() };
  }
  return {};
}

export function mergeRunEvents(a: RunEvent[], b: RunEvent[]): RunEvent[] {
  const bySeq = new Map<number, RunEvent>();
  for (const e of [...a, ...b]) bySeq.set(e.seq, e);
  return Array.from(bySeq.values()).sort((x, y) => x.seq - y.seq);
}
