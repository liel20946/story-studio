// Story Studio — typed IPC wrapper
// All backend calls go through window.electronAPI — never raw invoke.

import type {
  StorySummary,
  StoryDetail,
  RunResult,
  RunRecord,
  AppSettings,
  RecordingAvailability,
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

export const storiesUpdate = (
  name: string,
  variables: { key: string; value: string }[],
): Promise<StoryDetail> => ipcInvoke("stories:update", { name, variables });

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

export const recordingStart = (
  name: string,
  url: string,
): Promise<{ ok: boolean; storyName?: string; error?: string }> =>
  ipcInvoke("recording:start", { name, url });

export const recordingCancel = (): Promise<{ ok: true }> =>
  ipcInvoke("recording:cancel");

export const runStart = (storyName: string): Promise<{ runId: string }> =>
  ipcInvoke("run:start", { storyName });

export const runBulkStart = (
  storyNames: string[],
): Promise<{
  bulkId: string;
  items: { storyName: string; storyTitle: string; runId: string }[];
}> => ipcInvoke("run:bulkStart", { storyNames });

export const runCancel = (runId: string): Promise<{ ok: true }> =>
  ipcInvoke("run:cancel", { runId });

export const runsList = (): Promise<RunResult[]> => ipcInvoke("runs:list");

export const runsGet = (runId: string): Promise<RunRecord> =>
  ipcInvoke("runs:get", { runId });

export const runsDelete = (runId: string): Promise<{ ok: true }> =>
  ipcInvoke("runs:delete", { runId });

export const runsClear = (): Promise<{ ok: true }> => ipcInvoke("runs:clear");

export const runsScreenshot = (
  path: string,
): Promise<{ dataUrl: string | null }> =>
  ipcInvoke("runs:screenshot", { path });

export const settingsGet = (): Promise<AppSettings> =>
  ipcInvoke("settings:get");

export const settingsSet = (
  patch: Partial<
    Pick<
      AppSettings,
      | "agentProvider"
      | "codexBinaryPath"
      | "claudeBinaryPath"
      | "theme"
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
  cb: (progress: { phase: string; message: string }) => void,
): () => void {
  return window.electronAPI.on("recording:progress", (payload: unknown) =>
    cb(payload as { phase: string; message: string }),
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
