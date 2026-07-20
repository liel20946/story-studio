import electronUpdater from "electron-updater";
import { autoUpdater as nativeMacUpdater } from "electron";

import { app, BrowserWindow, dialog } from "../electron-api.js";
import { logger } from "../logger.js";

const { autoUpdater } = electronUpdater;

let downloadedVersion: string | null = null;
let installInProgress = false;

function isUpdateEnabled(): boolean {
  return app.isPackaged;
}

/**
 * macOS + electron-updater: quitAndInstall() often fails to actually quit
 * while before-quit / window listeners are still attached (electron-builder#8997).
 * Strip those listeners, force-close windows, then quitAndInstall + app.exit().
 */
function quitAndInstallUpdate(): void {
  if (installInProgress) return;
  installInProgress = true;
  logger.info("updates", "Installing update and restarting");

  if (process.platform === "darwin") {
    app.removeAllListeners("before-quit");
    app.removeAllListeners("window-all-closed");
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      win.removeAllListeners("close");
      win.close();
    }
    nativeMacUpdater.once("before-quit-for-update", () => {
      app.exit(0);
    });
  }

  // isSilent / isForceRunAfter matter on Windows; on macOS we still pass true
  // for force-run-after so Squirrel relaunches when it can.
  autoUpdater.quitAndInstall(false, true);

  // Fallback if native before-quit-for-update never fires (still stuck alive).
  setTimeout(() => {
    logger.info("updates", "Forcing app.exit after quitAndInstall");
    app.exit(0);
  }, 2500);
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
    quitAndInstallUpdate();
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
    void promptRestartToInstall(info.version);
  });

  void autoUpdater.checkForUpdatesAndNotify().catch((error) => {
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
      await dialog.showMessageBox({
        type: "info",
        title: "No Updates",
        message: "You're running the latest version of Story Studio.",
      });
      return;
    }

    if (downloadedVersion === latestVersion) {
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
