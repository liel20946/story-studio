// ============================================================================
// Story Studio — frontend copy of the shared IPC contract
// ============================================================================

export type BowserStoryMode = "recorded" | "generated";

export type ImportMode = "overwrite" | "add";

export interface ImportPreviewFile {
  path: string;
  siteSlug: string;
  storyCount: number;
}

export interface ImportPreview {
  storyCount: number;
  fileCount: number;
  files: ImportPreviewFile[];
  errors: string[];
  valid: boolean;
}

export interface ExportPreview {
  storyCount: number;
  fileCount: number;
}

export interface StorySummary {
  name: string;
  title: string;
  baseUrl?: string;
  createdAt: number;
  lastRun?: { status: RunStatus; finishedAt: number } | null;
  siteSlug?: string;
  storyId?: string;
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
export type AgentProvider = "codex" | "claude-code";

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
  status: "running" | "ok" | "failed" | "cancelled";
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
  agentProvider?: AgentProvider;
  agentModel?: string;
}

export interface RunRecord extends RunResult {
  events: RunEvent[];
}

/** Snapshot of an in-flight run returned by runs:active for UI hydration. */
export interface ActiveRunSnapshot {
  runId: string;
  storyName: string;
  storyTitle: string;
  startedAt: number;
  events: RunEvent[];
  agentProvider?: AgentProvider;
  agentModel?: string;
}

export interface RecordingProgress {
  phase: "starting" | "recording" | "converting" | "done" | "error";
  message: string;
  storyName?: string;
  errorTitle?: string;
  detail?: string;
}

export interface RecordingAvailability {
  agentAvailable: boolean;
  playwrightAvailable: boolean;
  browserInstalled: boolean;
}

export type ThemePreference = "system" | "light" | "dark";
export type { ColorThemeId } from "./color-themes";
export type {
  CodexModel,
  CodexEffort,
  ClaudeModel,
  ClaudeEffort,
  AgentCapabilities,
  AgentModelOption,
} from "./agent-config";

import type {
  CodexModel,
  CodexEffort,
  ClaudeModel,
  ClaudeEffort,
} from "./agent-config";
import type { ColorThemeId, ColorThemePalette } from "./color-themes";

export interface AppSettings {
  agentProvider: AgentProvider;
  codexBinaryPath: string | null;
  claudeBinaryPath: string | null;
  codexModel: CodexModel;
  codexEffort: CodexEffort;
  claudeModel: ClaudeModel;
  claudeEffort: ClaudeEffort;
  storiesDir: string;
  runsDir: string;
  theme: ThemePreference;
  colorThemeLight: ColorThemeId;
  colorThemeDark: ColorThemeId;
  colorThemePaletteLight: ColorThemePalette | null;
  colorThemePaletteDark: ColorThemePalette | null;
  colorThemeContrastLight: number;
  colorThemeContrastDark: number;
  usePointerCursors: boolean;
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

export interface BulkRunOptions {
  storyIds?: string[];
  headed?: boolean;
  baseUrlOverride?: string;
  /** How many story agents may run at once (1–8). Defaults to 3. */
  maxParallel?: number;
  /** Optional free-text condition; when matched against a finished story, remaining work stops. */
  stopCondition?: string;
}

export type BulkSessionStatus = "running" | "stopped" | "completed";
export type BulkItemPhase = "pending" | "running" | "done" | "skipped";
export type BulkStopCause = "user" | "condition";

export interface BulkSessionSnapshot {
  bulkId: string;
  status: BulkSessionStatus;
  maxParallel: number;
  stopCondition: string;
  stopReason?: string;
  /** Why the bulk stopped — drives the status pill in the UI. */
  stopCause?: BulkStopCause;
  items: Array<{
    storyName: string;
    storyTitle: string;
    runId: string;
    phase: BulkItemPhase;
  }>;
}

export interface ScheduledRun {
  id: string;
  name: string;
  storyNames: string[];
  scheduledAt: number;
  repeat?: ScheduleRepeat;
  hour?: number;
  minute?: number;
  dayOfWeek?: number;
  enabled: boolean;
  createdAt: number;
  lastRunAt: number | null;
}

export type ScheduleRepeat = "once" | "daily" | "weekly";

export type GenerateConversationStatus = "active" | "complete";

export type GenerateMessage =
  | { kind: "user"; text: string; at: number }
  | { kind: "assistant"; text: string; at: number }
  | { kind: "status"; text: string; at: number }
  | { kind: "draft"; at: number; storyTitle: string; summary: string; draftMd?: string }
  | { kind: "error"; text: string; at: number };

export interface GenerateConversation {
  id: string;
  title: string;
  status: GenerateConversationStatus;
  draftId: string;
  storyName?: string;
  createdAt: number;
  updatedAt: number;
  messages: GenerateMessage[];
  generating?: boolean;
  /** Provider session is established — follow-up turns use resume instead of replaying history. */
  agentSessionEstablished?: boolean;
  /** Codex rollout session id (parsed from first exec). Claude uses conversation id. */
  codexSessionId?: string;
  /** Agent provider used when the session was created (reset session if provider changes). */
  agentSessionProvider?: AgentProvider;
}

export interface GenerateConversationSummary {
  id: string;
  title: string;
  status: GenerateConversationStatus;
  storyName?: string;
  createdAt: number;
  updatedAt: number;
  generating: boolean;
}

export interface GenerateConversationDetail extends GenerateConversation {
  draftMd?: string;
  draftYaml?: string;
}

export interface AgentModelOverride {
  model: string;
  effort: string;
}

export interface GenerateProgress {
  conversationId: string;
  message: string;
}
