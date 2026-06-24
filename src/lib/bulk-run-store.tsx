// ============================================================================
// Story Studio — global bulk-run store
// Holds the currently-launched bulk run (the set of stories fired together)
// at the app root so it survives navigation away from /bulk-run. Without this,
// the launched set lived in BulkRunView local state, so leaving and returning
// to the bulk view reset it to the selection screen even while runs were still
// in progress.
// ============================================================================

import * as React from "react";

// One story launched as part of a bulk run: the runId it was given plus the
// minimal display info the dashboard needs (kept here, not the full summary,
// so the launched set is cheap to persist).
export interface BulkLaunchedItem {
  storyName: string;
  storyTitle: string;
  runId: string;
}

interface BulkRunStoreValue {
  launched: BulkLaunchedItem[] | null;
  setLaunched: (items: BulkLaunchedItem[] | null) => void;
}

const BulkRunStoreContext = React.createContext<BulkRunStoreValue | null>(null);

export function BulkRunProvider({ children }: { children: React.ReactNode }) {
  const [launched, setLaunched] = React.useState<BulkLaunchedItem[] | null>(
    null,
  );

  const value = React.useMemo<BulkRunStoreValue>(
    () => ({ launched, setLaunched }),
    [launched],
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
