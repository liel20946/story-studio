// ============================================================================
// Story Studio — global bulk-run store
// Holds the currently-launched bulk run (the set of stories fired together)
// at the app root so it survives navigation away from /bulk-run. Persisted to
// sessionStorage so remounts (HMR, StrictMode) don't drop back to selection
// while stories are still running.
// ============================================================================

import * as React from "react";
import type { BulkItemPhase, BulkSessionStatus } from "./contract-types";

const STORAGE_KEY = "story-studio:bulk-session";

// One story launched as part of a bulk run: the runId it was given plus the
// minimal display info the dashboard needs (kept here, not the full summary,
// so the launched set is cheap to persist).
export interface BulkLaunchedItem {
  storyName: string;
  storyTitle: string;
  runId: string;
  phase?: BulkItemPhase;
}

export interface BulkSessionState {
  bulkId: string;
  items: BulkLaunchedItem[];
  maxParallel: number;
  stopCondition: string;
  status: BulkSessionStatus;
  stopReason?: string;
}

export function readPersistedSession(): BulkSessionState | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const obj = parsed as Partial<BulkSessionState>;
    if (!Array.isArray(obj.items) || obj.items.length === 0) return null;
    if (typeof obj.bulkId !== "string") return null;
    return {
      bulkId: obj.bulkId,
      items: obj.items as BulkLaunchedItem[],
      maxParallel: typeof obj.maxParallel === "number" ? obj.maxParallel : 3,
      stopCondition: typeof obj.stopCondition === "string" ? obj.stopCondition : "",
      status: (obj.status as BulkSessionStatus) ?? "running",
      stopReason: obj.stopReason,
    };
  } catch {
    return null;
  }
}

/** @deprecated prefer readPersistedSession */
export function readPersistedLaunched(): BulkLaunchedItem[] | null {
  return readPersistedSession()?.items ?? null;
}

function persistSession(session: BulkSessionState | null): void {
  try {
    if (session?.items.length) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // ignore quota / private-mode errors
  }
}

interface BulkRunStoreValue {
  session: BulkSessionState | null;
  setSession: (
    session:
      | BulkSessionState
      | null
      | ((prev: BulkSessionState | null) => BulkSessionState | null),
  ) => void;
  /** Convenience: launched items for dashboard rendering. */
  launched: BulkLaunchedItem[] | null;
  setLaunched: (items: BulkLaunchedItem[] | null) => void;
}

const BulkRunStoreContext = React.createContext<BulkRunStoreValue | null>(null);

export function BulkRunProvider({ children }: { children: React.ReactNode }) {
  const [session, setSessionState] = React.useState<BulkSessionState | null>(
    readPersistedSession,
  );

  const setSession = React.useCallback(
    (
      next:
        | BulkSessionState
        | null
        | ((prev: BulkSessionState | null) => BulkSessionState | null),
    ) => {
      setSessionState((prev) => {
        const resolved = typeof next === "function" ? next(prev) : next;
        persistSession(resolved);
        return resolved;
      });
    },
    [],
  );

  const setLaunched = React.useCallback(
    (items: BulkLaunchedItem[] | null) => {
      setSession((prev) => {
        if (!items?.length) return null;
        return {
          bulkId: prev?.bulkId ?? `local-${Date.now()}`,
          items,
          maxParallel: prev?.maxParallel ?? 3,
          stopCondition: prev?.stopCondition ?? "",
          status: prev?.status ?? "running",
          stopReason: prev?.stopReason,
        };
      });
    },
    [setSession],
  );

  const value = React.useMemo<BulkRunStoreValue>(
    () => ({
      session,
      setSession,
      launched: session?.items ?? null,
      setLaunched,
    }),
    [session, setSession, setLaunched],
  );

  return (
    <BulkRunStoreContext.Provider value={value}>
      {children}
    </BulkRunStoreContext.Provider>
  );
}

export function useBulkRun(): BulkRunStoreValue {
  const ctx = React.useContext(BulkRunStoreContext);
  if (!ctx) {
    throw new Error("useBulkRun must be used within a BulkRunProvider");
  }
  return ctx;
}
