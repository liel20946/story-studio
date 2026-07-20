// One agent run at a time. Parallel browser MCP sessions would need distinct
// MCP aliases / profiles; until then, extra starts wait in this queue and show
// as "Queued" in the UI.

export const MAX_CONCURRENT_RUNS = 1;
let _activeRuns = 0;
const _runWaiters: Array<() => void> = [];

/** True when a new run would have to wait for an in-flight run to finish. */
export function isRunSlotBusy(): boolean {
  return _activeRuns >= MAX_CONCURRENT_RUNS;
}

// Counting semaphore: every acquire is paired with exactly one release, so the
// active count stays correct even for runs cancelled while still queued.
export function acquireRunSlot(): Promise<void> {
  if (_activeRuns < MAX_CONCURRENT_RUNS) {
    _activeRuns++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => _runWaiters.push(resolve));
}

export function releaseRunSlot(): void {
  const next = _runWaiters.shift();
  if (next) next(); // hand the slot to the next queued run (count unchanged)
  else _activeRuns = Math.max(0, _activeRuns - 1);
}
