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
import { onRunEvent, onRunResult, runsActive } from "./ipc";
import { reportAppErrorFromUnknown } from "./app-error";
import type { RunEvent, RunResult, ActiveRunSnapshot, AgentProvider } from "./contract-types";
import {
  filterTimelineEvents,
  isBenignCodexStderrEvent,
  isThinkingEvent,
  metadataFromRunEvents,
  mergeRunEvents,
} from "./run-events";

export interface ActiveRunState {
  runId: string;
  storyName: string;
  storyTitle: string; // display title (so the run view shows the story name)
  startedAt: number;
  events: RunEvent[];
  result: RunResult | null; // null while running
  agentProvider?: AgentProvider;
  agentModel?: string;
}

interface RunStoreValue {
  runs: Record<string, ActiveRunState>;
  /** Register a run as soon as it is started, before any events arrive. */
  registerRun: (
    runId: string,
    storyName: string,
    storyTitle: string,
    agent?: { agentProvider: AgentProvider; agentModel: string },
  ) => void;
}

const RunStoreContext = React.createContext<RunStoreValue | null>(null);

function applySnapshot(
  prev: Record<string, ActiveRunState>,
  snapshot: ActiveRunSnapshot,
): Record<string, ActiveRunState> {
  const existing = prev[snapshot.runId];
  if (existing?.result) return prev;

  const mergedEvents = mergeRunEvents(existing?.events ?? [], snapshot.events);
  const fromEvents = metadataFromRunEvents(mergedEvents);

  return {
    ...prev,
    [snapshot.runId]: {
      runId: snapshot.runId,
      storyName: snapshot.storyName || existing?.storyName || "",
      storyTitle:
        snapshot.storyTitle ||
        existing?.storyTitle ||
        fromEvents.storyTitle ||
        "",
      startedAt: snapshot.startedAt || existing?.startedAt || Date.now(),
      agentProvider: snapshot.agentProvider ?? existing?.agentProvider,
      agentModel: snapshot.agentModel ?? existing?.agentModel,
      events: mergedEvents,
      result: null,
    },
  };
}

export function RunStoreProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [runs, setRuns] = React.useState<Record<string, ActiveRunState>>({});

  const registerRun = React.useCallback(
    (
      runId: string,
      storyName: string,
      storyTitle: string,
      agent?: { agentProvider: AgentProvider; agentModel: string },
    ) => {
      setRuns((prev) => {
        const existing = prev[runId];
        if (existing?.result) return prev;
        return {
          ...prev,
          [runId]: {
            runId,
            storyName: storyName || existing?.storyName || "",
            storyTitle: storyTitle || existing?.storyTitle || "",
            startedAt: existing?.startedAt ?? Date.now(),
            agentProvider: agent?.agentProvider ?? existing?.agentProvider,
            agentModel: agent?.agentModel ?? existing?.agentModel,
            events: existing?.events ?? [],
            result: null,
          },
        };
      });
    },
    [],
  );

  // Hydrate from the main process BEFORE subscribing to live events — otherwise
  // the first event creates a nameless run entry that breaks the sidebar title
  // and the story-row running indicator (which keys off storyName).
  React.useEffect(() => {
    let cancelled = false;
    let unsubEvent = () => {};
    let unsubResult = () => {};

    void (async () => {
      try {
        const snapshots = await runsActive();
        if (!cancelled && snapshots.length > 0) {
          setRuns((prev) => {
            let next = prev;
            for (const snap of snapshots) {
              next = applySnapshot(next, snap);
            }
            return next;
          });
        }
      } catch (err) {
        reportAppErrorFromUnknown("Failed to restore active runs", err);
      }

      if (cancelled) return;

      unsubEvent = onRunEvent((ev) => {
        if (isBenignCodexStderrEvent(ev) || isThinkingEvent(ev)) return;
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
          const nextEvents = filterTimelineEvents([...base.events]);
          const idx = nextEvents.findIndex((e) => e.seq === ev.seq);
          if (idx >= 0) {
            nextEvents[idx] = ev;
          } else {
            nextEvents.push(ev);
            nextEvents.sort((a, b) => a.seq - b.seq);
          }
          const filtered = filterTimelineEvents(nextEvents);
          const fromEvents = metadataFromRunEvents(filtered);
          return {
            ...prev,
            [ev.runId]: {
              ...base,
              storyTitle: base.storyTitle || fromEvents.storyTitle || "",
              events: filtered,
            },
          };
        });
      });

      unsubResult = onRunResult((res) => {
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
              agentProvider: res.agentProvider ?? base.agentProvider,
              agentModel: res.agentModel ?? base.agentModel,
              events: filterTimelineEvents(base.events),
              result: res,
            },
          };
        });
        queryClient.invalidateQueries({ queryKey: ["runs:list"] });
        queryClient.invalidateQueries({ queryKey: ["stories:list"] });
      });
    })();

    return () => {
      cancelled = true;
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
  agent?: { agentProvider: AgentProvider; agentModel: string },
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
  storyTitle?: string,
): ActiveRunState | undefined {
  const { runs } = useRunStore();
  return React.useMemo(
    () =>
      Object.values(runs).find(
        (r) =>
          r.result === null &&
          (r.storyName === storyName ||
            (!!storyTitle && r.storyTitle === storyTitle)),
      ),
    [runs, storyName, storyTitle],
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
