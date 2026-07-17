import electronUpdater from "electron-updater";

import { app, dialog } from "../electron-api.js";
import { logger } from "../logger.js";

const { autoUpdater } = electronUpdater;

let downloadedVersion: string | null = null;

function isUpdateEnabled(): boolean {
  return app.isPackaged;
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
    autoUpdater.quitAndInstall();
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

  if (downloadedVersion) {
    await promptRestartToInstall(downloadedVersion);
    return;
  }

  try {
    const result = await autoUpdater.checkForUpdates();
    const latestVersion = result?.updateInfo.version;
    const currentVersion = app.getVersion();

    if (!latestVersion || latestVersion === currentVersion) {
      await dialog.showMessageBox({
        type: "info",
        title: "No Updates",
        message: "You're running the latest version of Story Studio.",
      });
      return;
    }

    await dialog.showMessageBox({
      type: "info",
      title: "Update Available",
      message: `Story Studio ${latestVersion} is available.`,
      detail: "The update will download in the background. You'll be prompted to restart when it's ready.",
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
