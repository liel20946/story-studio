import type { SetupStatus } from "./contract-types";

let cachedSetupStatus: SetupStatus | null = null;

export const SETUP_STATUS_CHANGED_EVENT = "story-studio:setup-changed";

export function getCachedSetupStatus(): SetupStatus | null {
  return cachedSetupStatus;
}

export function setCachedSetupStatus(status: SetupStatus): SetupStatus {
  cachedSetupStatus = status;
  window.dispatchEvent(new CustomEvent(SETUP_STATUS_CHANGED_EVENT));
  return cachedSetupStatus;
}

export function agentCliReady(status: SetupStatus | null): {
  codex: boolean;
  claude: boolean;
} {
  return {
    codex: status?.items.find((item) => item.id === "codex")?.ready === true,
    claude: status?.items.find((item) => item.id === "claude")?.ready === true,
  };
}
