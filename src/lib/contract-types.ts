// ============================================================================
// Story Studio — frontend copy of the shared IPC contract
// Copied from project-plans/ipc-contract.ts — do NOT import across boundaries.
// Keep in sync with project-plans/ipc-contract.ts manually.
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

// One row in the live timeline. Backend maps each codex JSONL `item` to one of these.
export type RunEventKind =
  | "navigate" // playwright__browser-navigate
  | "click" // browser-click / browser-press / browser-select
  | "type" // browser-type / browser-fill
  | "snapshot" // browser-snapshot
  | "screenshot" // browser-take-screenshot
  | "wait" // browser-wait-for
  | "assert" // assertion evaluation
  | "evaluate" // browser_evaluate (script execution) — shown as "Thinking"
  | "tool" // any other MCP / command tool call
  | "message" // agent_message text
  | "reasoning" // reasoning summary
  | "status" // lifecycle: started / loading codex / finished
  | "error"; // failed tool call or error event

export interface RunEvent {
  runId: string;
  seq: number; // monotonic 0,1,2... for stable ordering
  ts: number; // epoch ms
  kind: RunEventKind;
  label: string; // friendly title, e.g. "Navigate", "Click", "Type"
  detail?: string; // url / typed text / target / message body / error text
  status: "running" | "ok" | "failed";
}

export interface AssertionResult {
  text: string;
  passed: boolean;
  evidence?: string;
}

// Sent as the `run:result` notification AND used as the summary in runs:list.
export interface RunResult {
  runId: string;
  storyName: string;
  storyTitle: string;
  status: RunStatus;
  summary: string;
  assertions: AssertionResult[];
  screenshotUrl?: string; // ready-to-use protocol URL for <img src>
  screenshotPath?: string; // absolute fs path (reference only)
  lastSuccessfulStep?: string;
  startedAt: number;
  finishedAt: number;
  tokenUsage?: { inputTokens: number; outputTokens: number };
  error?: string; // populated when status === "error"
}

// Persisted history record = result + full timeline (returned by runs:get).
export interface RunRecord extends RunResult {
  events: RunEvent[];
}

// ---------- Recording ----------
export interface RecordingProgress {
  phase: "starting" | "recording" | "converting" | "done" | "error";
  message: string;
}

export interface RecordingAvailability {
  codexAvailable: boolean; // codex binary resolved
  playwrightAvailable: boolean; // `npx playwright --version` ok
  browserInstalled: boolean; // chromium present
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
