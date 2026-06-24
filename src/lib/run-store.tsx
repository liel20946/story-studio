// ============================================================================
// Story Studio — global run store
// Tracks in-progress and recently-finished runs at the app root so run state
// survives navigation. Subscribes ONCE to run:event / run:result for the whole
// app lifetime, accumulating each run's timeline + result keyed by runId.
//
// Without this, run state lived only inside the mounted LiveRunView, so leaving
// /run/$runId (e.g. opening another story) dropped every event and the run
// "disappeared" even though it was still running in the background.
// ============================================================================

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { onRunEvent, onRunResult } from "./ipc";
import type { RunEvent, RunResult } from "./contract-types";
import { filterTimelineEvents, isBenignCodexStderrEvent } from "./run-events";

export interface ActiveRunState {
  runId: string;
  storyName: string;
  storyTitle: string; // display title (so the run view shows the story name)
  startedAt: number;
  events: RunEvent[];
  result: RunResult | null; // null while running
}

interface RunStoreValue {
  runs: Record<string, ActiveRunState>;
  /** Register a run as soon as it is started, before any events arrive. */
  registerRun: (runId: string, storyName: string, storyTitle: string) => void;
}

const RunStoreContext = React.createContext<RunStoreValue | null>(null);

export function RunStoreProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [runs, setRuns] = React.useState<Record<string, ActiveRunState>>({});

  const registerRun = React.useCallback(
    (runId: string, storyName: string, storyTitle: string) => {
      setRuns((prev) => {
        if (prev[runId]) return prev;
        return {
          ...prev,
          [runId]: {
            runId,
            storyName,
            storyTitle,
            startedAt: Date.now(),
            events: [],
            result: null,
          },
        };
      });
    },
    [],
  );

  React.useEffect(() => {
    const unsubEvent = onRunEvent((ev) => {
      if (isBenignCodexStderrEvent(ev)) return;
      setRuns((prev) => {
        const existing = prev[ev.runId];
        const base: ActiveRunState =
          existing ?? {
            runId: ev.runId,
            storyName: "",
            storyTitle: "",
            startedAt: ev.ts,
            events: [],
            result: null,
          };
        // Upsert by seq for stable ordering (codex emits started + completed
        // for one item; both share a seq and must replace in place).
        const nextEvents = filterTimelineEvents([...base.events]);
        const idx = nextEvents.findIndex((e) => e.seq === ev.seq);
        if (idx >= 0) {
          nextEvents[idx] = ev;
        } else {
          nextEvents.push(ev);
          nextEvents.sort((a, b) => a.seq - b.seq);
        }
        return {
          ...prev,
          [ev.runId]: { ...base, events: filterTimelineEvents(nextEvents) },
        };
      });
    });

    const unsubResult = onRunResult((res) => {
      setRuns((prev) => {
        const existing = prev[res.runId];
        const base: ActiveRunState =
          existing ?? {
            runId: res.runId,
            storyName: res.storyName,
            storyTitle: res.storyTitle,
            startedAt: res.startedAt,
            events: [],
            result: null,
          };
        return {
          ...prev,
          [res.runId]: {
            ...base,
            storyName: base.storyName || res.storyName,
            storyTitle: base.storyTitle || res.storyTitle,
            events: filterTimelineEvents(base.events),
            result: res,
          },
        };
      });
      // Refresh history + story-status badges whenever any run finishes —
      // even if the user navigated away from the live run view.
      queryClient.invalidateQueries({ queryKey: ["runs:list"] });
      queryClient.invalidateQueries({ queryKey: ["stories:list"] });
    });

    return () => {
      unsubEvent();
      unsubResult();
    };
  }, [queryClient]);

  const value = React.useMemo<RunStoreValue>(
    () => ({ runs, registerRun }),
    [runs, registerRun],
  );

  return (
    <RunStoreContext.Provider value={value}>
      {children}
    </RunStoreContext.Provider>
  );
}

function useRunStore(): RunStoreValue {
  const ctx = React.useContext(RunStoreContext);
  if (!ctx) {
    throw new Error("useRunStore must be used within a RunStoreProvider");
  }
  return ctx;
}

/** Imperative access to registerRun (used when starting a run). */
export function useRegisterRun(): (
  runId: string,
  storyName: string,
  storyTitle: string,
) => void {
  return useRunStore().registerRun;
}

/** Full accumulated state for one run (events + result), or undefined. */
export function useRun(runId: string): ActiveRunState | undefined {
  return useRunStore().runs[runId];
}

/** The whole run map — used by the bulk runner to track many runs at once. */
export function useAllRuns(): Record<string, ActiveRunState> {
  return useRunStore().runs;
}

/** The active (not-yet-finished) run for a story, if one is in progress. */
export function useActiveRunForStory(
  storyName: string,
): ActiveRunState | undefined {
  const { runs } = useRunStore();
  return React.useMemo(
    () =>
      Object.values(runs).find(
        (r) => r.storyName === storyName && r.result === null,
      ),
    [runs, storyName],
  );
}

/** Map of storyName -> active runId for stories with a run in progress. */
export function useActiveRunMap(): Map<string, string> {
  const { runs } = useRunStore();
  return React.useMemo(() => {
    const map = new Map<string, string>();
    for (const r of Object.values(runs)) {
      if (r.result === null && r.storyName) map.set(r.storyName, r.runId);
    }
    return map;
  }, [runs]);
}

/** Set of story names that currently have a run in progress. */
export function useRunningStoryNames(): Set<string> {
  const { runs } = useRunStore();
  return React.useMemo(
    () =>
      new Set(
        Object.values(runs)
          .filter((r) => r.result === null && r.storyName)
          .map((r) => r.storyName),
      ),
    [runs],
  );
}
