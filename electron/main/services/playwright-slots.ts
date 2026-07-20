// Shared concurrency cap for Playwright MCP browser sessions. Each story agent
// holds one slot while its browser is active. Bulk runs fire every story at
// once (see bulk-runner.ts) and rely on this hard process ceiling to queue
// any excess.
import { getSettingsValue } from "../handlers/settings.js";

export const MAX_CONCURRENT_PLAYWRIGHT = 8;

let _activePlaywright = 0;
const _playwrightWaiters: Array<() => void> = [];

function currentPlaywrightLimit(): number {
  const mode = getSettingsValue().browserMode;
  return mode === "existing-chrome" || mode === "codex-chrome"
    ? 1
    : MAX_CONCURRENT_PLAYWRIGHT;
}

export function acquirePlaywrightSlot(): Promise<void> {
  if (_activePlaywright < currentPlaywrightLimit()) {
    _activePlaywright++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => _playwrightWaiters.push(resolve));
}

export function releasePlaywrightSlot(): void {
  _activePlaywright = Math.max(0, _activePlaywright - 1);
  while (
    _playwrightWaiters.length > 0 &&
    _activePlaywright < currentPlaywrightLimit()
  ) {
    _activePlaywright++;
    _playwrightWaiters.shift()?.();
  }
}

export function getActivePlaywrightCount(): number {
  return _activePlaywright;
}

export function getAvailablePlaywrightSlots(): number {
  return Math.max(0, currentPlaywrightLimit() - _activePlaywright);
}
