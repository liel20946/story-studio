// ============================================================================
// Story Studio — recording store
// ============================================================================

import * as React from "react";
import { recordingStart, recordingCancel, recordingAbort, onRecordingProgress } from "./ipc";
import { reportAppError } from "./app-error";

export type RecordingPhase =
  | "idle"
  | "starting"
  | "recording"
  | "converting"
  | "done"
  | "error";

interface RecordingState {
  active: boolean;
  phase: RecordingPhase;
  message: string;
  storyName: string | null;
  error: string | null;
  errorTitle: string | null;
  errorDetail: string | null;
}

interface RecordingValue extends RecordingState {
  start: (
    name: string,
    url: string,
    overwriteStoryKey?: string,
  ) => Promise<void>;
  stop: () => Promise<void>;
  abort: () => Promise<void>;
  reset: () => void;
}

const initialState: RecordingState = {
  active: false,
  phase: "idle",
  message: "",
  storyName: null,
  error: null,
  errorTitle: null,
  errorDetail: null,
};

const RecordingContext = React.createContext<RecordingValue | null>(null);

export function RecordingProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<RecordingState>(initialState);

  React.useEffect(() => {
    const unsub = onRecordingProgress((p) => {
      setState((s) => {
        if (!s.active) return s;
        if (p.phase === "error") {
          const title = p.errorTitle ?? "Recording failed";
          const message =
            p.message.trim() === title.trim() ? "" : p.message.trim();
          reportAppError(title, message, p.detail);
          return {
            ...s,
            phase: "error",
            message: message || title,
            errorTitle: title,
            errorDetail: p.detail ?? s.errorDetail,
            storyName: p.storyName ?? s.storyName,
          };
        }
        return {
          ...s,
          phase: p.phase as RecordingPhase,
          message: p.message,
          storyName: p.storyName ?? s.storyName,
          errorTitle: p.errorTitle ?? s.errorTitle,
          errorDetail: p.detail ?? s.errorDetail,
        };
      });
    });
    return unsub;
  }, []);

  const start = React.useCallback(
    async (name: string, url: string, overwriteStoryKey?: string) => {
    if (!name.trim() || !url.trim()) return;
    setState({
      active: true,
      phase: "starting",
      message: "Starting recording…",
      storyName: null,
      error: null,
      errorTitle: null,
      errorDetail: null,
    });
    try {
      const res = await recordingStart({
        name: name.trim(),
        url: url.trim(),
        overwriteStoryKey: overwriteStoryKey?.trim() || undefined,
      });
      setState((s) => {
        if (!s.active) return s;
        if (res.cancelled) return initialState;
        if (res.ok && res.storyName) {
          return {
            ...s,
            phase: "done",
            message: "Story saved to library.",
            storyName: res.storyName,
          };
        }
        const err = res.error ?? "Recording failed.";
        const title = res.errorTitle ?? "Recording failed";
        const message = err.trim() === title.trim() ? "" : err;
        return {
          ...s,
          phase: "error",
          message: message || title,
          error: message || title,
          errorTitle: title,
          errorDetail: res.errorDetail ?? null,
        };
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      reportAppError("Recording failed", msg);
      setState((s) => {
        if (!s.active) return s;
        return {
          ...s,
          phase: "error",
          message: msg,
          error: msg,
          errorTitle: "Recording failed",
          errorDetail: msg,
        };
      });
    }
  }, []);

  const stop = React.useCallback(async () => {
    setState((s) => ({
      ...s,
      phase: "converting",
      message: "Converting with AI…",
    }));
    try {
      await recordingCancel();
    } catch {
      // Conversion still proceeds via the recorder's close handler.
    }
  }, []);

  const abort = React.useCallback(async () => {
    setState(initialState);
    try {
      await recordingAbort();
    } catch {
      // UI already dismissed; backend cleanup is best-effort.
    }
  }, []);

  const reset = React.useCallback(() => setState(initialState), []);

  const value = React.useMemo<RecordingValue>(
    () => ({ ...state, start, stop, abort, reset }),
    [state, start, stop, abort, reset],
  );

  return (
    <RecordingContext.Provider value={value}>
      {children}
    </RecordingContext.Provider>
  );
}

export function useRecording(): RecordingValue {
  const ctx = React.useContext(RecordingContext);
  if (!ctx) {
    throw new Error("useRecording must be used within a RecordingProvider");
  }
  return ctx;
}
