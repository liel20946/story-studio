// Story Studio — typed IPC wrapper
// All backend calls go through window.electronAPI — never raw invoke.

import type {
  StorySummary,
  StoryDetail,
  StoryDraft,
  RunResult,
  RunRecord,
  AppSettings,
  RecordingAvailability,
  DraftDetail,
  BulkRunOptions,
  ScheduledRun,
  GenerateConversation,
  GenerateConversationSummary,
  GenerateConversationDetail,
} from "./contract-types";

export function ipcInvoke<Res>(channel: string, req?: unknown): Promise<Res> {
  return window.electronAPI.invoke<Res>(channel, req);
}

export const storiesList = (): Promise<StorySummary[]> =>
  ipcInvoke("stories:list");

export const storiesGet = (name: string): Promise<StoryDetail> =>
  ipcInvoke("stories:get", { name });

export const storiesDelete = (name: string): Promise<{ ok: true }> =>
  ipcInvoke("stories:delete", { name });

export const storiesImport = (paths?: string[]): Promise<StorySummary[]> =>
  ipcInvoke("stories:import", { paths });

export const storiesExport = (
  destDir?: string,
): Promise<{ fileCount: number; canceled: boolean }> =>
  ipcInvoke("stories:export", { destDir });

export const storiesUpdate = (
  name: string,
  content: {
    steps: string[];
    variables: { key: string; value: string }[];
    assertions: string[];
  },
): Promise<StoryDetail> => ipcInvoke("stories:update", { name, ...content });

export const storiesRename = (
  name: string,
  title: string,
): Promise<StoryDetail> => ipcInvoke("stories:rename", { name, title });

export const storiesOpenFile = (name: string): Promise<{ ok: true }> =>
  ipcInvoke("stories:openFile", { name });

export const clipboardWriteText = (text: string): Promise<{ ok: true }> =>
  ipcInvoke("app:copyText", { text });

export const recordingCheck = (): Promise<RecordingAvailability> =>
  ipcInvoke("recording:check");

export const recordingInstallBrowser = (): Promise<{
  ok: boolean;
  error?: string;
}> => ipcInvoke("recording:installBrowser");

export const recordingStart = (params: {
  name: string;
  url: string;
  overwriteStoryKey?: string;
}): Promise<{
  ok: boolean;
  storyName?: string;
  draftId?: string;
  error?: string;
  errorTitle?: string;
  errorDetail?: string;
  cancelled?: boolean;
}> => ipcInvoke("recording:start", params);

export const recordingCancel = (): Promise<{ ok: true }> =>
  ipcInvoke("recording:cancel");

export const recordingAbort = (): Promise<{ ok: true }> =>
  ipcInvoke("recording:abort");

export const runStart = (
  storyName: string,
): Promise<{ runId: string; agentProvider: import("./contract-types").AgentProvider; agentModel: string }> =>
  ipcInvoke("run:start", { storyName });

export const runBulkStart = (
  storyNames: string[],
  options?: BulkRunOptions,
): Promise<{
  bulkId: string;
  items: { storyName: string; storyTitle: string; runId: string }[];
  agentProvider: import("./contract-types").AgentProvider;
  agentModel: string;
}> => ipcInvoke("run:bulkStart", { storyNames, options });

export const runCancel = (runId: string): Promise<{ ok: true }> =>
  ipcInvoke("run:cancel", { runId });

export const runsList = (): Promise<RunResult[]> => ipcInvoke("runs:list");

export const runsActive = (): Promise<import("./contract-types").ActiveRunSnapshot[]> =>
  ipcInvoke("runs:active");

export const runsGet = (runId: string): Promise<RunRecord> =>
  ipcInvoke("runs:get", { runId });

export const runsDelete = (runId: string): Promise<{ ok: true }> =>
  ipcInvoke("runs:delete", { runId });

export const runsClear = (): Promise<{ ok: true }> => ipcInvoke("runs:clear");

export const runsScreenshot = (
  path: string,
): Promise<{ dataUrl: string | null }> =>
  ipcInvoke("runs:screenshot", { path });

export const runsLiveScreenshots = (
  runId: string,
): Promise<{ paths: string[] }> =>
  ipcInvoke("runs:liveScreenshots", { runId });

export const settingsGet = (): Promise<AppSettings> =>
  ipcInvoke("settings:get");

export const agentGetAllCapabilities = (): Promise<{
  codex: import("./contract-types").AgentCapabilities;
  claude: import("./contract-types").AgentCapabilities;
}> => ipcInvoke("agent:getAllCapabilities");

export const agentGetCapabilities = (
  provider: import("./contract-types").AgentProvider,
): Promise<import("./contract-types").AgentCapabilities> =>
  ipcInvoke("agent:getCapabilities", { provider });

export const settingsSet = (
  patch: Partial<
    Pick<
      AppSettings,
      | "agentProvider"
      | "codexBinaryPath"
      | "claudeBinaryPath"
      | "codexModel"
      | "codexEffort"
      | "claudeModel"
      | "claudeEffort"
      | "theme"
      | "colorThemeLight"
      | "colorThemeDark"
      | "colorThemePaletteLight"
      | "colorThemePaletteDark"
      | "colorThemeContrastLight"
      | "colorThemeContrastDark"
      | "usePointerCursors"
      | "startingUrl"
      | "runHook"
    >
  >,
): Promise<AppSettings> => ipcInvoke("settings:set", patch);

export const openSettings = (): Promise<void> =>
  ipcInvoke("window:openSettings");

export const closeSettings = (): Promise<void> =>
  ipcInvoke("window:closeSettings");

export function onStoriesChanged(
  cb: (stories: StorySummary[]) => void,
): () => void {
  return window.electronAPI.on("stories:changed", (payload: unknown) =>
    cb(payload as StorySummary[]),
  );
}

export function onRecordingProgress(
  cb: (progress: import("./contract-types").RecordingProgress) => void,
): () => void {
  return window.electronAPI.on("recording:progress", (payload: unknown) =>
    cb(payload as import("./contract-types").RecordingProgress),
  );
}

export function onRunEvent(
  cb: (event: import("./contract-types").RunEvent) => void,
): () => void {
  return window.electronAPI.on("run:event", (payload: unknown) =>
    cb(payload as import("./contract-types").RunEvent),
  );
}

export function onRunResult(cb: (result: RunResult) => void): () => void {
  return window.electronAPI.on("run:result", (payload: unknown) =>
    cb(payload as RunResult),
  );
}

export const draftsList = () => ipcInvoke<StoryDraft[]>("drafts:list");
export const draftsGet = (draftId: string) =>
  ipcInvoke<DraftDetail>("drafts:get", { draftId });
export const draftsApprove = (draftId: string) =>
  ipcInvoke<{ ok: true; storyName: string }>("drafts:approve", { draftId });
export const draftsDiscard = (draftId: string) =>
  ipcInvoke<{ ok: true }>("drafts:discard", { draftId });

export const schedulesList = (): Promise<ScheduledRun[]> =>
  ipcInvoke("schedules:list");

export const schedulesGet = (id: string): Promise<ScheduledRun> =>
  ipcInvoke("schedules:get", { id });

export const schedulesCreate = (input: {
  name: string;
  storyNames: string[];
  scheduledAt: number;
  enabled?: boolean;
  repeat?: import("./contract-types").ScheduleRepeat;
  hour?: number;
  minute?: number;
  dayOfWeek?: number;
}): Promise<ScheduledRun> => ipcInvoke("schedules:create", input);

export const schedulesUpdate = (
  id: string,
  patch: Partial<
    Pick<
      ScheduledRun,
      | "name"
      | "storyNames"
      | "scheduledAt"
      | "enabled"
      | "repeat"
      | "hour"
      | "minute"
      | "dayOfWeek"
      | "lastRunAt"
    >
  >,
): Promise<ScheduledRun> => ipcInvoke("schedules:update", { id, ...patch });

export const schedulesDelete = (id: string): Promise<{ ok: true }> =>
  ipcInvoke("schedules:delete", { id });

export function onSchedulesChanged(
  cb: (schedules: ScheduledRun[]) => void,
): () => void {
  return window.electronAPI.on("schedules:changed", (payload: unknown) =>
    cb(payload as ScheduledRun[]),
  );
}

export function onSchedulesFired(
  cb: (payload: {
    scheduleId: string;
    items: { storyName: string; storyTitle: string; runId: string }[];
    agentProvider: import("./contract-types").AgentProvider;
    agentModel: string;
  }) => void,
): () => void {
  return window.electronAPI.on("schedules:fired", (payload: unknown) =>
    cb(
      payload as {
        scheduleId: string;
        items: { storyName: string; storyTitle: string; runId: string }[];
        agentProvider: import("./contract-types").AgentProvider;
        agentModel: string;
      },
    ),
  );
}

export const generateList = (): Promise<GenerateConversationSummary[]> =>
  ipcInvoke("generate:list");

export const generateCreate = (): Promise<GenerateConversation> =>
  ipcInvoke("generate:create");

export const generateGet = (
  conversationId: string,
): Promise<GenerateConversationDetail> =>
  ipcInvoke("generate:get", { conversationId });

export const generateSend = (
  conversationId: string,
  text: string,
): Promise<{ ok: true; conversation: GenerateConversation }> =>
  ipcInvoke("generate:send", { conversationId, text });

export const generateApprove = (
  conversationId: string,
): Promise<{ ok: true; storyName: string; conversation: GenerateConversation }> =>
  ipcInvoke("generate:approve", { conversationId });

export const generateCancel = (
  conversationId: string,
): Promise<{ ok: true; cancelled: boolean }> =>
  ipcInvoke("generate:cancel", { conversationId });

export const generateDelete = (
  conversationId: string,
): Promise<{ ok: true }> => ipcInvoke("generate:delete", { conversationId });

export const generateRename = (
  conversationId: string,
  title: string,
): Promise<{ ok: true; conversation: GenerateConversation }> =>
  ipcInvoke("generate:rename", { conversationId, title });

export function onGenerateChanged(
  cb: (summaries: GenerateConversationSummary[]) => void,
): () => void {
  return window.electronAPI.on("generate:changed", (payload: unknown) =>
    cb(payload as GenerateConversationSummary[]),
  );
}

export function onGenerateProgress(
  cb: (progress: import("./contract-types").GenerateProgress) => void,
): () => void {
  return window.electronAPI.on("generate:progress", (payload: unknown) =>
    cb(payload as import("./contract-types").GenerateProgress),
  );
}
