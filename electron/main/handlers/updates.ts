import { ipcMain } from "../electron-api.js";
import type { UpdateErrorKind, UpdatePhase } from "../services/contract-types.js";
import {
  applyMockUpdateStatus,
  checkForUpdates,
  downloadAvailableUpdate,
  getUpdateStatus,
  installDownloadedUpdate,
  openManualDownloadPage,
} from "../services/auto-update-service.js";

const UPDATE_PHASES = new Set<UpdatePhase>([
  "idle",
  "checking",
  "available",
  "downloading",
  "ready",
  "error",
]);

const UPDATE_ERROR_KINDS = new Set<UpdateErrorKind>([
  "check",
  "download",
  "install",
]);

export function registerUpdateHandlers(): void {
  ipcMain.handle("updates:getStatus", async () => getUpdateStatus());

  ipcMain.handle("updates:check", async () =>
    checkForUpdates({ userInitiated: true }),
  );

  ipcMain.handle("updates:download", async () => downloadAvailableUpdate());

  ipcMain.handle("updates:install", async () => installDownloadedUpdate());

  ipcMain.handle("updates:openDownloadPage", async () =>
    openManualDownloadPage(),
  );

  ipcMain.handle("updates:mockSet", async (_event, params: unknown) => {
    const patch =
      typeof params === "object" && params !== null
        ? (params as Record<string, unknown>)
        : {};
    const phase =
      typeof patch.phase === "string" && UPDATE_PHASES.has(patch.phase as UpdatePhase)
        ? (patch.phase as UpdatePhase)
        : undefined;
    const errorKind =
      typeof patch.errorKind === "string" &&
      UPDATE_ERROR_KINDS.has(patch.errorKind as UpdateErrorKind)
        ? (patch.errorKind as UpdateErrorKind)
        : undefined;
    return applyMockUpdateStatus({
      phase,
      availableVersion:
        typeof patch.availableVersion === "string"
          ? patch.availableVersion
          : undefined,
      percent: typeof patch.percent === "number" ? patch.percent : undefined,
      error: typeof patch.error === "string" ? patch.error : undefined,
      errorKind,
    });
  });
}
