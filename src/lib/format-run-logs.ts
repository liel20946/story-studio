import type { RunEvent, RunResult } from "./contract-types";
import { filterTimelineEvents } from "./run-events";

export interface RunLogInput {
  runId: string;
  storyName?: string;
  storyTitle?: string;
  startedAt: number;
  events: RunEvent[];
  result?: RunResult | null;
}

function formatTimestamp(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

function formatDurationMs(ms: number): string {
  const secs = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/** Plain-text run log for clipboard / bug reports. */
export function formatRunLogs(input: RunLogInput): string {
  const { runId, storyName, storyTitle, startedAt, events, result } = input;
  const lines: string[] = [];

  lines.push("Story Studio — Run Log");
  lines.push("=".repeat(40));
  lines.push(`Run ID: ${runId}`);
  if (storyTitle) lines.push(`Story: ${storyTitle}`);
  if (storyName) lines.push(`Story name: ${storyName}`);
  lines.push(`Started: ${formatTimestamp(startedAt)}`);

  if (result) {
    lines.push(`Status: ${result.status}`);
    lines.push(`Finished: ${formatTimestamp(result.finishedAt)}`);
    lines.push(`Duration: ${formatDurationMs(result.finishedAt - result.startedAt)}`);
    if (result.error) lines.push(`Error: ${result.error}`);
    if (result.summary) lines.push(`Summary: ${result.summary}`);
    if (result.lastSuccessfulStep) {
      lines.push(`Last successful step: ${result.lastSuccessfulStep}`);
    }
    if (result.tokenUsage) {
      lines.push(
        `Tokens: ${result.tokenUsage.inputTokens} in / ${result.tokenUsage.outputTokens} out`,
      );
    }
    if (result.screenshotPath) lines.push(`Screenshot: ${result.screenshotPath}`);

    if (result.assertions.length > 0) {
      lines.push("");
      lines.push("Assertions");
      lines.push("-".repeat(40));
      for (const assertion of result.assertions) {
        lines.push(`${assertion.passed ? "PASS" : "FAIL"}: ${assertion.text}`);
        if (assertion.evidence) lines.push(`  Evidence: ${assertion.evidence}`);
      }
    }
  } else {
    lines.push("Status: running");
    lines.push(`Elapsed: ${formatDurationMs(Date.now() - startedAt)}`);
  }

  lines.push("");
  lines.push("Timeline");
  lines.push("-".repeat(40));

  const sorted = filterTimelineEvents([...events]).sort((a, b) => a.seq - b.seq);
  if (sorted.length === 0) {
    lines.push("(no events yet)");
  } else {
    for (const event of sorted) {
      const detail = event.detail ? ` — ${event.detail}` : "";
      lines.push(
        `[${formatTimestamp(event.ts)}] [${event.status}] ${event.kind}: ${event.label}${detail}`,
      );
    }
  }

  return lines.join("\n");
}
