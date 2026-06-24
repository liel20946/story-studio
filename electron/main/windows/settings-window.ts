import { BrowserWindow } from "../electron-api.js";
import { getAppIcon } from "../app-icon.js";
import { getPreloadPath, getSettingsWindowLoadOptions } from "./window-paths.js";
import { logger } from "../logger.js";

let settingsWindow: BrowserWindow | null = null;

export async function openSettingsWindow(): Promise<void> {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }

  logger.info("settings", "Creating settings window");

  settingsWindow = new BrowserWindow({
    width: 520,
    height: 560,
    minWidth: 400,
    minHeight: 320,
    title: "Settings",
    icon: getAppIcon(),
    show: false,
    center: true,
    backgroundColor: "#141416",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  settingsWindow.once("ready-to-show", () => {
    settingsWindow?.show();
  });

  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });

  const load = getSettingsWindowLoadOptions();
  logger.info("settings", "Loading settings window", load);

  if ("url" in load) {
    await settingsWindow.loadURL(load.url);
  } else {
    await settingsWindow.loadFile(load.file, load.query ? { query: load.query } : undefined);
  }
}

export function getSettingsWindow(): BrowserWindow | null {
  return settingsWindow;
}
