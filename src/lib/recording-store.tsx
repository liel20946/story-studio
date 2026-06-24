// ============================================================================
// Story Studio — recording store
// Holds the in-flight recording session (phase + message + result) and owns the
// single `recording:progress` subscription. RecordView is a route-mounted view
// that can REMOUNT mid-recording (a remount reset its local phase back to
// "ready", so the user never saw the recording / Stop & Save state and the
// session looked stuck). Keeping the session here — outside the ephemeral view,
// mounted once near the app root — makes recording state survive remounts, the
// same fix the run-store applies to runs.
// ============================================================================

import * as React from "react";
import { recordingStart, recordingCancel, onRecordingProgress } from "./ipc";

export type RecordingPhase =
  | "idle"
  | "starting"
  | "recording"
  | "converting"
  | "done"
  | "error";

interface RecordingState {
  /** True from start() until the session is finalized (done/error consumed). */
  active: boolean;
  phase: RecordingPhase;
  message: string;
  /** Resulting story name once a recording is saved. */
  storyName: string | null;
  error: string | null;
}

interface RecordingValue extends RecordingState {
  start: (name: string, url: string) => Promise<void>;
  /** Stop codegen and convert the recording into a story. */
  stop: () => Promise<void>;
  /** Clear the session back to idle (call when the dialog closes). */
  reset: () => void;
}

const initialState: RecordingState = {
  active: false,
  phase: "idle",
  message: "",
  storyName: null,
  error: null,
};

const RecordingContext = React.createContext<RecordingValue | null>(null);

export function RecordingProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<RecordingState>(initialState);

  // Subscribe ONCE. Backend broadcasts starting → recording → converting →
  // done/error; we only apply them while a session is active so stray late
  // notifications can't resurrect a finished session.
  React.useEffect(() => {
    const unsub = onRecordingProgress((p) => {
      setState((s) => {
        if (!s.active) return s;
        return { ...s, phase: p.phase as RecordingPhase, message: p.message };
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
      error: null,
    });
    try {
      const res = await recordingStart(name.trim(), url.trim());
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
    // The backend SIGTERMs codegen; its close handler reads the recorded script
    // and proceeds to conversion. Optimistically reflect that here.
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
