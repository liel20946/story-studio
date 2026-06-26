// ============================================================================
// Story Studio — global bulk-run store
// Holds the currently-launched bulk run (the set of stories fired together)
// at the app root so it survives navigation away from /bulk-run. Persisted to
// sessionStorage so remounts (HMR, StrictMode) don't drop back to selection
// while stories are still running.
// ============================================================================

import * as React from "react";

const STORAGE_KEY = "story-studio:bulk-launched";

// One story launched as part of a bulk run: the runId it was given plus the
// minimal display info the dashboard needs (kept here, not the full summary,
// so the launched set is cheap to persist).
export interface BulkLaunchedItem {
  storyName: string;
  storyTitle: string;
  runId: string;
}

export function readPersistedLaunched(): BulkLaunchedItem[] | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return parsed as BulkLaunchedItem[];
  } catch {
    return null;
  }
}

function persistLaunched(items: BulkLaunchedItem[] | null): void {
  try {
    if (items?.length) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // ignore quota / private-mode errors
  }
}

interface BulkRunStoreValue {
  launched: BulkLaunchedItem[] | null;
  setLaunched: (items: BulkLaunchedItem[] | null) => void;
}

const BulkRunStoreContext = React.createContext<BulkRunStoreValue | null>(null);

export function BulkRunProvider({ children }: { children: React.ReactNode }) {
  const [launched, setLaunchedState] = React.useState<BulkLaunchedItem[] | null>(
    readPersistedLaunched,
  );

  const setLaunched = React.useCallback((items: BulkLaunchedItem[] | null) => {
    setLaunchedState(items);
    persistLaunched(items);
  }, []);

  const value = React.useMemo<BulkRunStoreValue>(
    () => ({ launched, setLaunched }),
    [launched, setLaunched],
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
