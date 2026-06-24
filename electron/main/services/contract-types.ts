// ============================================================================
// Story Studio — BACKEND COPY OF IPC CONTRACT TYPES
// Copied from project-plans/ipc-contract.ts — do NOT import that file.
// Keep in sync manually if the contract changes.
// ============================================================================

// ---------- Stories ----------
export interface StorySummary {
  name: string; // kebab-case id = filename without ".story.md"
  title: string; // frontmatter `title` (fallback: first # heading, fallback: name)
  baseUrl?: string; // frontmatter `base_url`
  lastRun?: { status: RunStatus; finishedAt: number } | null;
}

export interface StoryVariable {
  key: string;
  value: string;
  secret: boolean; // true if key matches /password|secret|token/i
}

export interface StoryDetail extends StorySummary {
  filePath: string;
  variables: StoryVariable[];
  steps: string[]; // ordered step lines (markdown stripped of list numbering)
  assertions: string[];
  raw: string; // raw .story.md contents (for an optional "source" view)
}

// ---------- Runs ----------
export type RunStatus = "passed" | "failed" | "cancelled" | "error";

export type RunEventKind =
  | "navigate"
  | "click"
  | "type"
  | "snapshot"
  | "screenshot"
  | "wait"
  | "assert"
  | "evaluate"
  | "tool"
  | "message"
  | "reasoning"
  | "status"
  | "error";

export interface RunEvent {
  runId: string;
  seq: number;
  ts: number;
  kind: RunEventKind;
  label: string;
  detail?: string;
  status: "running" | "ok" | "failed";
}

export interface AssertionResult {
  text: string;
  passed: boolean;
  evidence?: string;
}

export interface RunResult {
  runId: string;
  storyName: string;
  storyTitle: string;
  status: RunStatus;
  summary: string;
  assertions: AssertionResult[];
  screenshotUrl?: string;
  screenshotPath?: string;
  lastSuccessfulStep?: string;
  startedAt: number;
  finishedAt: number;
  tokenUsage?: { inputTokens: number; outputTokens: number };
  error?: string;
}

export interface RunRecord extends RunResult {
  events: RunEvent[];
}

// ---------- Recording ----------
export interface RecordingProgress {
  phase: "starting" | "recording" | "converting" | "done" | "error";
  message: string;
}

export interface RecordingAvailability {
  codexAvailable: boolean;
  playwrightAvailable: boolean;
  browserInstalled: boolean;
}

// ---------- Settings ----------
export type AgentProvider = "codex" | "claude-code";
export type ThemePreference = "system" | "light" | "dark";

export interface AppSettings {
  agentProvider: AgentProvider; // which CLI runs stories (default: codex)
  codexBinaryPath: string | null; // null => auto-resolve
  claudeBinaryPath: string | null; // null => auto-resolve
  storiesDir: string;
  runsDir: string;
  theme: ThemePreference; // app appearance (dark is the default look)
  startingUrl: string; // pre-filled Start URL when recording a new story
  runHook: string; // appended to the end of the run prompt sent to the agent
}
