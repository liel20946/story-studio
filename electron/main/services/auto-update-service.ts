import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import electronUpdater from "electron-updater";

import { app, BrowserWindow, dialog, shell } from "../electron-api.js";
import { logger } from "../logger.js";

const { autoUpdater } = electronUpdater;
const execFileAsync = promisify(execFile);

const RELEASES_LATEST_URL =
  "https://github.com/liel20946/story-studio/releases/latest";

let downloadedVersion: string | null = null;
let downloadedFilePath: string | null = null;
let installInProgress = false;

function isUpdateEnabled(): boolean {
  return app.isPackaged;
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

async function openManualDownloadFallback(error: unknown): Promise<void> {
  const detail =
    error instanceof Error ? error.message : String(error);
  const { response } = await dialog.showMessageBox({
    type: "error",
    title: "Update Install Failed",
    message: "Could not apply the update automatically.",
    detail: `${detail}\n\nDownload the latest DMG from GitHub and replace Story Studio in Applications.`,
    buttons: ["Open Download Page", "OK"],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) {
    await shell.openExternal(RELEASES_LATEST_URL);
  }
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
      } catch (error) {
        logger.error("updates", "quitAndInstall failed", error);
      }
      forceExitSoon();
    });
  } catch (error) {
    installInProgress = false;
    logger.error("updates", "Failed to install update", error);
    await openManualDownloadFallback(error);
  }
}

async function promptRestartToInstall(version: string): Promise<void> {
  const { response } = await dialog.showMessageBox({
    type: "info",
    title: "Update Ready",
    message: `Story Studio ${version} has been downloaded.`,
    detail: "Restart the app to install the update.",
    buttons: ["Restart Now", "Later"],
    defaultId: 0,
    cancelId: 1,
  });

  if (response === 0) {
    await quitAndInstallUpdate();
  }
}

export function initAutoUpdates(): void {
  if (!isUpdateEnabled()) {
    logger.debug("updates", "Skipping auto-updates in development");
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    logger.info("updates", "Checking for updates");
  });

  autoUpdater.on("update-available", (info) => {
    logger.info("updates", "Update available", info.version);
  });

  autoUpdater.on("update-not-available", () => {
    logger.debug("updates", "App is up to date");
  });

  autoUpdater.on("error", (error) => {
    logger.error("updates", "Auto-update error", error);
  });

  autoUpdater.on("update-downloaded", (info) => {
    downloadedVersion = info.version;
    downloadedFilePath = info.downloadedFile;
    logger.info("updates", "Update downloaded", {
      version: info.version,
      file: info.downloadedFile,
    });
    void promptRestartToInstall(info.version);
  });

  // Prefer checkForUpdates over checkForUpdatesAndNotify so we own the prompt
  // (system notifications do not run our install path).
  void autoUpdater.checkForUpdates().catch((error) => {
    logger.debug("updates", "Update check skipped or failed", error);
  });
}

export async function checkForUpdatesManually(): Promise<void> {
  if (!isUpdateEnabled()) {
    await dialog.showMessageBox({
      type: "info",
      title: "Check for Updates",
      message: "Updates are only available in the packaged app.",
    });
    return;
  }

  try {
    // Always re-check the remote so we don't get stuck prompting for a
    // previously downloaded version (e.g. 1.5.8) after a newer one ships.
    const result = await autoUpdater.checkForUpdates();
    const latestVersion = result?.updateInfo.version;
    const currentVersion = app.getVersion();

    if (!latestVersion || latestVersion === currentVersion) {
      downloadedVersion = null;
      downloadedFilePath = null;
      await dialog.showMessageBox({
        type: "info",
        title: "No Updates",
        message: "You're running the latest version of Story Studio.",
      });
      return;
    }

    if (downloadedVersion === latestVersion && downloadedFilePath) {
      await promptRestartToInstall(downloadedVersion);
      return;
    }

    // A newer build is available than whatever we already staged — clear the
    // stale prompt target; update-downloaded will fire when the new zip lands.
    if (downloadedVersion && downloadedVersion !== latestVersion) {
      logger.info(
        "updates",
        `Discarding staged ${downloadedVersion}; fetching ${latestVersion}`,
      );
      downloadedVersion = null;
      downloadedFilePath = null;
    }

    await dialog.showMessageBox({
      type: "info",
      title: "Update Available",
      message: `Story Studio ${latestVersion} is available.`,
      detail:
        "The update will download in the background. You'll be prompted to restart when it's ready.",
    });
  } catch (error) {
    logger.error("updates", "Manual update check failed", error);
    await dialog.showMessageBox({
      type: "error",
      title: "Update Check Failed",
      message: "Could not check for updates. Try again later.",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
