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

export function filterTimelineEvents(events: RunEvent[]): RunEvent[] {
  return events.filter((e) => !isBenignCodexStderrEvent(e));
}
