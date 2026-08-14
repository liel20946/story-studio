import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import electronUpdater from "electron-updater";

import { app, BrowserWindow, shell } from "../electron-api.js";
import { broadcast } from "../broadcast.js";
import { logger } from "../logger.js";
import type {
  UpdateErrorKind,
  UpdatePhase,
  UpdateStatus,
} from "./contract-types.js";

const { autoUpdater } = electronUpdater;
const execFileAsync = promisify(execFile);

const RELEASES_LATEST_URL =
  "https://github.com/liel20946/story-studio/releases/latest";

/** Quiet background poll. */
const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const MOCK_VERSION = "99.0.0";

let downloadedVersion: string | null = null;
let downloadedFilePath: string | null = null;
let installInProgress = false;
let downloadInFlight = false;
let checkInFlight = false;
let initialized = false;
let mockDownloadTimer: ReturnType<typeof setTimeout> | null = null;

let phase: UpdatePhase = "idle";
let availableVersion: string | undefined;
let percent: number | undefined;
let error: string | undefined;
let errorKind: UpdateErrorKind | undefined;

function isMockUpdates(): boolean {
  return (
    !app.isPackaged &&
    (process.env.STORY_STUDIO_MOCK_UPDATE === "1" ||
      process.env.STORY_STUDIO_MOCK_UPDATE === "true")
  );
}

function isUpdateEnabled(): boolean {
  return app.isPackaged || isMockUpdates();
}

function currentVersion(): string {
  return app.getVersion();
}

function snapshot(): UpdateStatus {
  return {
    phase,
    enabled: isUpdateEnabled(),
    currentVersion: currentVersion(),
    availableVersion,
    percent,
    error,
    errorKind,
  };
}

function emitStatus(): UpdateStatus {
  const status = snapshot();
  broadcast("updates:status", status);
  return status;
}

function setIdle(): UpdateStatus {
  phase = "idle";
  availableVersion = undefined;
  percent = undefined;
  error = undefined;
  errorKind = undefined;
  return emitStatus();
}

function setPhase(
  next: UpdatePhase,
  patch?: Partial<
    Pick<UpdateStatus, "availableVersion" | "percent" | "error" | "errorKind">
  >,
): UpdateStatus {
  phase = next;
  if (patch && "availableVersion" in patch) {
    availableVersion = patch.availableVersion;
  }
  if (next === "downloading") {
    percent = patch?.percent ?? percent ?? 0;
  } else if (patch && "percent" in patch) {
    percent = patch.percent;
  } else {
    percent = undefined;
  }
  if (next === "error") {
    error = patch?.error;
    errorKind = patch?.errorKind;
  } else {
    error = undefined;
    errorKind = undefined;
  }
  return emitStatus();
}

export function getUpdateStatus(): UpdateStatus {
  return snapshot();
}

function prepareAppForQuit(): void {
  app.removeAllListeners("before-quit");
  app.removeAllListeners("window-all-closed");
  app.removeAllListeners("activate");
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.removeAllListeners("close");
    win.destroy();
  }
}

function forceExitSoon(delayMs = 1500): void {
  setTimeout(() => {
    logger.info("updates", "Forcing app.exit after install");
    app.exit(0);
  }, delayMs);
}

function getMacAppBundlePath(): string {
  // process.execPath = <App>.app/Contents/MacOS/<binary>
  return path.resolve(process.execPath, "..", "..", "..");
}

/**
 * Our CI mac builds are unsigned. Squirrel.Mac's quitAndInstall() requires a
 * signed app and often becomes a no-op (MacUpdater waits for squirrelDownloaded
 * that never arrives when autoInstallOnAppQuit is true).
 *
 * Instead: extract the already-downloaded zip, spawn a tiny helper that waits
 * for this process to exit, replaces the .app bundle, and relaunches.
 */
async function installMacUpdateFromZip(zipPath: string): Promise<void> {
  const appBundlePath = getMacAppBundlePath();
  if (!appBundlePath.endsWith(".app")) {
    throw new Error(`Unexpected app bundle path: ${appBundlePath}`);
  }
  if (!fs.existsSync(zipPath)) {
    throw new Error(`Downloaded update zip missing: ${zipPath}`);
  }

  await fs.promises.access(path.dirname(appBundlePath), fs.constants.W_OK);

  const stagingRoot = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "story-studio-update-"),
  );
  logger.info("updates", `Extracting update to ${stagingRoot}`);
  await execFileAsync("ditto", ["-xk", zipPath, stagingRoot]);

  const entries = await fs.promises.readdir(stagingRoot);
  const appEntry = entries.find((name) => name.endsWith(".app"));
  if (!appEntry) {
    throw new Error("Update zip did not contain an .app bundle");
  }
  const newAppPath = path.join(stagingRoot, appEntry);

  const scriptPath = path.join(
    os.tmpdir(),
    `story-studio-apply-update-${process.pid}.sh`,
  );
  const script = `#!/bin/bash
set -euo pipefail
PID="$1"
APP_BUNDLE="$2"
NEW_APP="$3"
STAGING="$4"
while kill -0 "$PID" 2>/dev/null; do sleep 0.2; done
sleep 0.4
rm -rf "$APP_BUNDLE"
ditto "$NEW_APP" "$APP_BUNDLE"
xattr -cr "$APP_BUNDLE" 2>/dev/null || true
open "$APP_BUNDLE"
rm -rf "$STAGING"
rm -f -- "$0"
`;
  await fs.promises.writeFile(scriptPath, script, { mode: 0o755 });

  const child = spawn(
    scriptPath,
    [String(process.pid), appBundlePath, newAppPath, stagingRoot],
    { detached: true, stdio: "ignore" },
  );
  child.unref();
  logger.info("updates", "Spawned macOS update apply script");
}

export async function openManualDownloadPage(): Promise<{ ok: true }> {
  await shell.openExternal(RELEASES_LATEST_URL);
  return { ok: true };
}

async function quitAndInstallUpdate(): Promise<void> {
  if (installInProgress) return;
  installInProgress = true;
  logger.info("updates", "Installing update and restarting");

  try {
    if (process.platform === "darwin") {
      if (!downloadedFilePath) {
        throw new Error("No downloaded update file is available yet.");
      }
      await installMacUpdateFromZip(downloadedFilePath);
      setImmediate(() => {
        prepareAppForQuit();
        app.exit(0);
      });
      forceExitSoon();
      return;
    }

    setImmediate(() => {
      prepareAppForQuit();
      try {
        autoUpdater.quitAndInstall(false, true);
      } catch (err) {
        logger.error("updates", "quitAndInstall failed", err);
      }
      forceExitSoon();
    });
  } catch (err) {
    installInProgress = false;
    logger.error("updates", "Failed to install update", err);
    setPhase("error", {
      error: err instanceof Error ? err.message : String(err),
      errorKind: "install",
    });
  }
}

function markDownloaded(version: string, filePath?: string): void {
  downloadedVersion = version;
  downloadedFilePath = filePath ?? downloadedFilePath;
  availableVersion = version;
  setPhase("ready", { availableVersion: version });
}

function startMockDownload(): void {
  if (mockDownloadTimer) {
    clearTimeout(mockDownloadTimer);
    mockDownloadTimer = null;
  }
  downloadInFlight = true;
  const steps = [8, 22, 41, 63, 81, 94, 100];
  let index = 0;
  setPhase("downloading", {
    availableVersion: availableVersion ?? MOCK_VERSION,
    percent: 0,
  });

  const tick = () => {
    const value = steps[index] ?? 100;
    setPhase("downloading", {
      availableVersion: availableVersion ?? MOCK_VERSION,
      percent: value,
    });
    index += 1;
    if (value >= 100) {
      downloadInFlight = false;
      mockDownloadTimer = null;
      markDownloaded(availableVersion ?? MOCK_VERSION);
      return;
    }
    mockDownloadTimer = setTimeout(tick, 220);
  };
  mockDownloadTimer = setTimeout(tick, 180);
}

async function checkMock(userInitiated: boolean): Promise<UpdateStatus> {
  if (phase === "downloading" || downloadInFlight) return snapshot();
  if (phase === "ready") return snapshot();
  if (userInitiated) setPhase("checking");
  await new Promise((resolve) => setTimeout(resolve, userInitiated ? 350 : 0));
  availableVersion = MOCK_VERSION;
  return setPhase("available", { availableVersion: MOCK_VERSION });
}

export async function checkForUpdates(options?: {
  userInitiated?: boolean;
}): Promise<UpdateStatus> {
  const userInitiated = options?.userInitiated === true;

  if (!isUpdateEnabled()) {
    return snapshot();
  }

  if (phase === "downloading" || downloadInFlight) {
    return snapshot();
  }

  if (isMockUpdates()) {
    return checkMock(userInitiated);
  }

  if (checkInFlight) return snapshot();
  checkInFlight = true;
  if (userInitiated && phase === "idle") {
    setPhase("checking");
  }

  try {
    const result = await autoUpdater.checkForUpdates();
    const latestVersion = result?.updateInfo.version;
    const installed = currentVersion();

    if (!latestVersion || latestVersion === installed) {
      downloadedVersion = null;
      downloadedFilePath = null;
      if (userInitiated || phase === "checking" || phase === "available") {
        setIdle();
      }
      return snapshot();
    }

    availableVersion = latestVersion;

    if (downloadedVersion === latestVersion && downloadedFilePath) {
      return setPhase("ready", { availableVersion: latestVersion });
    }

    if (downloadedVersion && downloadedVersion !== latestVersion) {
      logger.info(
        "updates",
        `Discarding staged ${downloadedVersion}; fetching ${latestVersion}`,
      );
      downloadedVersion = null;
      downloadedFilePath = null;
    }

    if (phase !== "ready") {
      setPhase("available", { availableVersion: latestVersion });
    }
    return snapshot();
  } catch (err) {
    logger.error("updates", "Update check failed", err);
    if (userInitiated || phase === "checking" || phase === "idle") {
      setPhase("error", {
        error: err instanceof Error ? err.message : String(err),
        errorKind: "check",
      });
    }
    return snapshot();
  } finally {
    checkInFlight = false;
  }
}

export async function downloadAvailableUpdate(): Promise<UpdateStatus> {
  if (phase === "ready") return snapshot();
  if (phase === "downloading" || downloadInFlight) return snapshot();

  if (!isUpdateEnabled()) {
    return snapshot();
  }

  if (isMockUpdates()) {
    startMockDownload();
    return snapshot();
  }

  if (phase !== "available" && phase !== "error") {
    const after = await checkForUpdates({ userInitiated: true });
    if (after.phase !== "available") return after;
  }

  downloadInFlight = true;
  setPhase("downloading", {
    availableVersion,
    percent: 0,
  });

  try {
    await autoUpdater.downloadUpdate();
    return snapshot();
  } catch (err) {
    downloadInFlight = false;
    logger.error("updates", "Update download failed", err);
    return setPhase("error", {
      error: err instanceof Error ? err.message : String(err),
      errorKind: "download",
      availableVersion,
    });
  }
}

export async function installDownloadedUpdate(): Promise<{ ok: true }> {
  if (isMockUpdates()) {
    logger.info("updates", "Mock install — skipping quit");
    setIdle();
    return { ok: true };
  }

  if (phase !== "ready") {
    throw new Error("No update is ready to install.");
  }
  await quitAndInstallUpdate();
  return { ok: true };
}

export function applyMockUpdateStatus(patch: {
  phase?: UpdatePhase;
  availableVersion?: string;
  percent?: number;
  error?: string;
  errorKind?: UpdateErrorKind;
}): UpdateStatus {
  if (app.isPackaged) {
    throw new Error("Mock update status is only available in development");
  }
  if (mockDownloadTimer) {
    clearTimeout(mockDownloadTimer);
    mockDownloadTimer = null;
  }
  downloadInFlight = patch.phase === "downloading";
  const nextPhase = patch.phase ?? phase;
  if (nextPhase === "idle") {
    downloadedVersion = null;
    downloadedFilePath = null;
    return setIdle();
  }
  if (nextPhase === "ready") {
    const version = patch.availableVersion ?? availableVersion ?? MOCK_VERSION;
    downloadedVersion = version;
    return setPhase("ready", { availableVersion: version });
  }
  if (nextPhase === "available") {
    downloadedVersion = null;
    downloadedFilePath = null;
    return setPhase("available", {
      availableVersion: patch.availableVersion ?? MOCK_VERSION,
    });
  }
  if (nextPhase === "downloading") {
    return setPhase("downloading", {
      availableVersion: patch.availableVersion ?? availableVersion ?? MOCK_VERSION,
      percent: patch.percent ?? 42,
    });
  }
  if (nextPhase === "checking") {
    return setPhase("checking");
  }
  return setPhase("error", {
    availableVersion: patch.availableVersion ?? availableVersion,
    error: patch.error ?? "Could not download the update.",
    errorKind: patch.errorKind ?? "download",
  });
}

export function initAutoUpdates(): void {
  if (initialized) return;
  initialized = true;

  if (!app.isPackaged) {
    logger.debug(
      "updates",
      isMockUpdates()
        ? "Using mock in-app updates"
        : "Skipping auto-updates in development",
    );
    return;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    logger.info("updates", "Checking for updates");
  });

  autoUpdater.on("update-available", (info) => {
    logger.info("updates", "Update available", info.version);
    availableVersion = info.version;
    if (phase === "downloading" || phase === "ready") return;
    setPhase("available", { availableVersion: info.version });
  });

  autoUpdater.on("update-not-available", () => {
    logger.debug("updates", "App is up to date");
  });

  autoUpdater.on("error", (err) => {
    logger.error("updates", "Auto-update error", err);
    if (phase === "downloading") {
      downloadInFlight = false;
      setPhase("error", {
        error: err instanceof Error ? err.message : String(err),
        errorKind: "download",
        availableVersion,
      });
    }
  });

  autoUpdater.on("download-progress", (progress) => {
    const nextPercent = Math.max(
      0,
      Math.min(100, Math.round(progress.percent)),
    );
    if (phase === "downloading" && percent === nextPercent) return;
    setPhase("downloading", {
      availableVersion,
      percent: nextPercent,
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    downloadInFlight = false;
    logger.info("updates", "Update downloaded", {
      version: info.version,
      file: info.downloadedFile,
    });
    markDownloaded(info.version, info.downloadedFile);
  });

  void checkForUpdates().catch((err) => {
    logger.debug("updates", "Update check skipped or failed", err);
  });

  setInterval(() => {
    void checkForUpdates().catch((err) => {
      logger.debug("updates", "Periodic update check failed", err);
    });
  }, CHECK_INTERVAL_MS);
}

/** Menu bar "Check for Updates…" — same in-app flow, no dialogs. */
export async function checkForUpdatesManually(): Promise<void> {
  await checkForUpdates({ userInitiated: true });
}
