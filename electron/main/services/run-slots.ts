// One agent run at a time. Parallel browser MCP sessions would need distinct
// MCP aliases / profiles; until then, extra starts wait in this queue and show
// as "Queued" in the UI.

export const MAX_CONCURRENT_RUNS = 1;
let _activeRuns = 0;

interface RunSlotWaiter {
  runId: string;
  /** true = slot acquired; false = wait abandoned (cancelled while queued). */
  resolve: (acquired: boolean) => void;
}

const _runWaiters: RunSlotWaiter[] = [];

/** True when a new run would have to wait for an in-flight run to finish. */
export function isRunSlotBusy(): boolean {
  return _activeRuns >= MAX_CONCURRENT_RUNS;
}

/**
 * Counting semaphore: every successful acquire (resolved `true`) is paired with
 * exactly one release. Cancelled waits resolve `false` and must not release.
 */
export function acquireRunSlot(runId: string): Promise<boolean> {
  if (_activeRuns < MAX_CONCURRENT_RUNS) {
    _activeRuns++;
    return Promise.resolve(true);
  }
  return new Promise<boolean>((resolve) => {
    _runWaiters.push({ runId, resolve });
  });
}

/** Drop a queued waiter and unblock it with `acquired: false`. */
export function abandonRunSlotWait(runId: string): boolean {
  const idx = _runWaiters.findIndex((w) => w.runId === runId);
  if (idx < 0) return false;
  const [waiter] = _runWaiters.splice(idx, 1);
  waiter.resolve(false);
  return true;
}

export function releaseRunSlot(): void {
  const next = _runWaiters.shift();
  if (next) next.resolve(true); // hand the slot to the next queued run
  else _activeRuns = Math.max(0, _activeRuns - 1);
}
