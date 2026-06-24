// ============================================================================
// Story Studio — frontend copy of the shared IPC contract
// ============================================================================

export type BowserStoryMode = "recorded" | "generated";

export interface StorySummary {
  name: string;
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

export interface RecordingProgress {
  phase: "starting" | "recording" | "converting" | "done" | "error" | "review";
  message: string;
  draftId?: string;
  errorTitle?: string;
  detail?: string;
}

export interface RecordingAvailability {
  codexAvailable: boolean;
  playwrightAvailable: boolean;
  browserInstalled: boolean;
}

export type AgentProvider = "codex" | "claude-code";
export type ThemePreference = "system" | "light" | "dark";

export interface AppSettings {
  agentProvider: AgentProvider;
  codexBinaryPath: string | null;
  claudeBinaryPath: string | null;
  storiesDir: string;
  runsDir: string;
  theme: ThemePreference;
  startingUrl: string;
  runHook: string;
}

export interface StoryDraft {
  draftId: string;
  siteSlug: string;
  artifactDir: string;
  draftMdPath: string;
  draftYamlPath: string;
  recordingSpecPath?: string;
  createdAt: number;
}

export interface DraftDetail extends StoryDraft {
  draftMd: string;
  draftYaml: string;
  recordingSpec?: string;
}

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

export interface BulkRunOptions {
  storyIds?: string[];
  tags?: string[];
  headed?: boolean;
  baseUrlOverride?: string;
  maxParallel?: number;
}
