// ============================================================================
// Story Studio — recording store
// ============================================================================

import * as React from "react";
import { recordingStart, recordingCancel, onRecordingProgress } from "./ipc";

export type RecordingPhase =
  | "idle"
  | "starting"
  | "recording"
  | "converting"
  | "review"
  | "done"
  | "error";

interface RecordingState {
  active: boolean;
  phase: RecordingPhase;
  message: string;
  storyName: string | null;
  draftId: string | null;
  error: string | null;
}

interface RecordingValue extends RecordingState {
  start: (name: string, url: string) => Promise<{ draftId?: string } | void>;
  stop: () => Promise<void>;
  reset: () => void;
}

const initialState: RecordingState = {
  active: false,
  phase: "idle",
  message: "",
  storyName: null,
  draftId: null,
  error: null,
};

const RecordingContext = React.createContext<RecordingValue | null>(null);

export function RecordingProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<RecordingState>(initialState);

  React.useEffect(() => {
    const unsub = onRecordingProgress((p) => {
      setState((s) => {
        if (!s.active) return s;
        return {
          ...s,
          phase: p.phase as RecordingPhase,
          message: p.message,
          draftId: p.draftId ?? s.draftId,
        };
      });
    });
    return unsub;
  }, []);

  const start = React.useCallback(async (name: string, url: string) => {
    if (!name.trim() || !url.trim()) return;
    setState({
      active: true,
      phase: "starting",
      message: "Starting recording…",
      storyName: null,
      draftId: null,
      error: null,
    });
    try {
      const res = await recordingStart(name.trim(), url.trim());
      if (res.ok && res.draftId) {
        setState((s) => ({
          ...s,
          phase: "review",
          message: "Draft ready for review.",
          draftId: res.draftId!,
        }));
        return { draftId: res.draftId };
      }
      if (res.ok && res.storyName) {
        setState((s) => ({
          ...s,
          phase: "done",
          message: "Story recorded successfully.",
          storyName: res.storyName!,
        }));
      } else {
        const err = res.error ?? "Recording failed.";
        setState((s) => ({ ...s, phase: "error", message: err, error: err }));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setState((s) => ({
        ...s,
        phase: "error",
        message: `Recording failed: ${msg}`,
        error: msg,
      }));
    }
  }, []);

  const stop = React.useCallback(async () => {
    setState((s) => ({
      ...s,
      phase: "converting",
      message: "Finishing recording, converting to a story…",
    }));
    try {
      await recordingCancel();
    } catch {
      // Conversion still proceeds via the recorder's close handler.
    }
  }, []);

  const reset = React.useCallback(() => setState(initialState), []);

  const value = React.useMemo<RecordingValue>(
    () => ({ ...state, start, stop, reset }),
    [state, start, stop, reset],
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
