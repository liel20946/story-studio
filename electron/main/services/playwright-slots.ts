// Shared concurrency cap for Playwright MCP browser sessions. Each story agent
// holds one slot while its browser is active. Bulk runs additionally throttle
// with maxParallel in bulk-runner.ts; this is the hard process ceiling.
export const MAX_CONCURRENT_PLAYWRIGHT = 8;

let _activePlaywright = 0;
const _playwrightWaiters: Array<() => void> = [];

export function acquirePlaywrightSlot(): Promise<void> {
  if (_activePlaywright < MAX_CONCURRENT_PLAYWRIGHT) {
    _activePlaywright++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => _playwrightWaiters.push(resolve));
}

export function releasePlaywrightSlot(): void {
  const next = _playwrightWaiters.shift();
  if (next) next();
  else _activePlaywright = Math.max(0, _activePlaywright - 1);
}

export function getActivePlaywrightCount(): number {
  return _activePlaywright;
}

export function getAvailablePlaywrightSlots(): number {
  return Math.max(0, MAX_CONCURRENT_PLAYWRIGHT - _activePlaywright);
}
