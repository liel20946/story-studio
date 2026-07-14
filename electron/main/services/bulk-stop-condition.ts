import type { RunResult } from "./contract-types.js";

const STOP_WORDS = new Set([
  "stop",
  "when",
  "if",
  "the",
  "a",
  "an",
  "on",
  "any",
  "first",
  "must",
  "should",
  "bulk",
  "run",
  "story",
  "stories",
]);

/**
 * Evaluate an optional free-text stop condition against a just-finished story.
 * Empty condition never stops. Common phrasing like "stop on first failure"
 * matches failed/error results; otherwise tokens are matched against the result.
 */
export function shouldStopBulk(
  condition: string | undefined,
  result: RunResult,
): boolean {
  const raw = condition?.trim() ?? "";
  if (!raw) return false;

  const c = raw.toLowerCase();
  const failed = result.status === "failed" || result.status === "error";
  const passed = result.status === "passed";

  if (
    /^(stop\s+)?(on\s+)?(first\s+|any\s+)?(fail|failure|error)s?$/.test(c) ||
    /\b(first|any|on)\b.{0,24}\b(fail|failure|error)s?\b/.test(c) ||
    /\b(fail|failure|error)s?\b.{0,12}\b(stop|halt)\b/.test(c)
  ) {
    return failed;
  }

  if (/\b(first|any|on)\b.{0,24}\bpass(ed|ing)?\b/.test(c)) {
    return passed;
  }

  const haystack = [
    result.status,
    result.summary,
    result.error ?? "",
    result.storyTitle,
    result.storyName,
    ...result.assertions.map((a) => `${a.text} ${a.passed ? "passed" : "failed"}`),
  ]
    .join(" ")
    .toLowerCase();

  if (haystack.includes(c)) return true;

  const tokens = c
    .split(/[^a-z0-9_-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));

  if (tokens.length === 0) return false;
  return tokens.every((t) => haystack.includes(t));
}
