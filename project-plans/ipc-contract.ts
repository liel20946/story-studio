// ============================================================================
// Story Studio — SHARED IPC CONTRACT (reference spec, NOT compiled/bundled)
// ----------------------------------------------------------------------------
// This file lives in project-plans/ and is NOT part of main/ or renderer/ build
// roots. DO NOT import it across the main<->renderer boundary.
// Each layer must COPY the relevant types into its own local types module:
//   - backend  -> main/services/contract-types.ts
//   - frontend -> renderer/lib/contract-types.ts
// Channel names + payloads below are the single source of truth. Keep identical.
// ============================================================================

// ---------- Stories ----------
export interface StorySummary {
  name: string; // kebab-case id = filename without ".story.md"
  title: string; // frontmatter `title` (fallback: first # heading, fallback: name)
  baseUrl?: string; // frontmatter `base_url`
  createdAt: number; // frontmatter `created_at` (fallback: file birthtime / mtime)
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
export interface AppSettings {
  codexBinaryPath: string | null; // null => auto-resolve
  storiesDir: string;
  runsDir: string;
}

// ============================================================================
// IPC CHANNELS
// invoke = window.electronAPI.invoke(channel, req) -> res  (ipcMain.handle)
// notify = ipcMain.broadcast(channel, payload) -> onNotification(channel, cb)
// ============================================================================
//
// invoke  stories:list            req: void                         res: StorySummary[]
// invoke  stories:get             req: { name: string }             res: StoryDetail
// invoke  stories:delete          req: { name: string }             res: { ok: true }
// invoke  stories:import          req: { paths?: string[] }         res: StorySummary[]
//                                  (no paths => backend opens an open-file dialog,
//                                   default dir user home, multi-select *.story.md)
//
// invoke  recording:check         req: void                         res: RecordingAvailability
// invoke  recording:installBrowser req: void                        res: { ok: boolean; error?: string }
// invoke  recording:start         req: { name: string; url: string } res: { ok: boolean; storyName?: string; error?: string }
//                                  (resolves only AFTER codegen window closes + story written)
// invoke  recording:cancel        req: void                         res: { ok: true }
//
// invoke  run:start               req: { storyName: string }        res: { runId: string }
// invoke  run:cancel              req: { runId: string }            res: { ok: true }
//
// invoke  runs:list               req: void                         res: RunResult[]   (newest first, NO events)
// invoke  runs:get                req: { runId: string }            res: RunRecord     (WITH events)
//
// invoke  settings:get            req: void                         res: AppSettings
// invoke  settings:set            req: { codexBinaryPath?: string | null } res: AppSettings
//
// notify  stories:changed         payload: StorySummary[]           (fs.watch on stories dir)
// notify  recording:progress      payload: RecordingProgress
// notify  run:event               payload: RunEvent                 (live timeline streaming)
// notify  run:result              payload: RunResult                (run finished)
//
// ============================================================================
