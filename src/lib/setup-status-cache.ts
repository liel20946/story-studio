import type { SetupStatus } from "./contract-types";

let cachedSetupStatus: SetupStatus | null = null;

export function getCachedSetupStatus(): SetupStatus | null {
  return cachedSetupStatus;
}

export function setCachedSetupStatus(status: SetupStatus): SetupStatus {
  cachedSetupStatus = status;
  return cachedSetupStatus;
}
