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

export function filterTimelineEvents(events: RunEvent[]): RunEvent[] {
  return events.filter(
    (e) =>
      !isBenignCodexStderrEvent(e) &&
      !isThinkingEvent(e) &&
      !isInternalToolEvent(e) &&
      !isMetaStatusEvent(e),
  );
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
