// ============================================================================
// Story Studio — BACKEND COPY OF IPC CONTRACT TYPES
// Copied from project-plans/ipc-contract.ts — do NOT import that file.
// Keep in sync manually if the contract changes.
// ============================================================================

// ---------- Stories ----------
export type BowserStoryMode = "recorded" | "generated";

export interface StorySummary {
  name: string; // composite: site-slug--story-id
  title: string;
  baseUrl?: string;
  createdAt: number;
  lastRun?: { status: RunStatus; finishedAt: number } | null;
  siteSlug?: string;
  storyId?: string;
  tags?: string[];
  mode?: BowserStoryMode;
}

export interface StoryVariable {
  key: string;
  value: string;
  secret: boolean;
}

export interface StoryDetail extends StorySummary {
  filePath: string;
  variables: StoryVariable[];
  steps: string[];
  assertions: string[];
  workflow: string[];
  raw: string;
}

// ---------- Runs ----------
export type RunStatus = "passed" | "failed" | "cancelled" | "error" | "blocked";

export interface RunStep {
  index: number;
  text: string;
  status: "passed" | "failed" | "blocked" | "running";
  startedAt?: string;
  finishedAt?: string;
  screenshot?: string | null;
  error?: string | null;
}

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
  screenshotPaths?: string[];
  steps?: RunStep[];
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
  phase: "starting" | "recording" | "converting" | "done" | "error" | "review";
  message: string;
  draftId?: string;
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
  runHook: string;
}

// ---------- Draft review ----------
export interface StoryDraft {
  draftId: string;
  siteSlug: string;
  artifactDir: string;
  draftMdPath: string;
  draftYamlPath: string;
  recordingSpecPath?: string;
  createdAt: number;
}

// ---------- Generate sessions ----------
export type GenerateMessageRole = "user" | "assistant" | "system";

export interface GenerateMessage {
  id: string;
  role: GenerateMessageRole;
  content: string;
  ts: number;
}

export interface GenerateSessionSummary {
  sessionId: string;
  siteSlug: string;
  url: string;
  status: "idle" | "running" | "ready" | "saved" | "discarded";
  updatedAt: number;
  draftStoryId?: string;
  draftStoryName?: string;
}

export interface GenerateSessionDetail extends GenerateSessionSummary {
  artifactDir: string;
  messages: GenerateMessage[];
  draftYaml?: string;
  draftMd?: string;
  screenshotPaths: string[];
}

export interface GenerateEvent {
  sessionId: string;
  seq: number;
  ts: number;
  kind: RunEventKind;
  label: string;
  detail?: string;
  status: "running" | "ok" | "failed";
}

// ---------- Bulk run options ----------
export interface BulkRunOptions {
  storyIds?: string[];
  tags?: string[];
  headed?: boolean;
  baseUrlOverride?: string;
  maxParallel?: number;
}
