import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { app, BrowserWindow, Menu, protocol, net } from "./electron-api.js";
import { registerHandlers } from "./handlers/index.js";
import { getPreloadPath, getMainWindowLoadOptions } from "./windows/window-paths.js";
import { getMacWindowChromeOptions, applyMacWindowChrome } from "./windows/window-chrome.js";
import { disableReloadShortcut } from "./windows/disable-reload-shortcut.js";
import { applyDefaultZoom } from "./windows/window-zoom.js";
import {
  getMainWindowStateOptions,
  trackMainWindowState,
  saveMainWindowState,
} from "./windows/window-state.js";
import { setMainWindow, navigateMainWindow } from "./windows/main-window.js";
import { applyWindowOpacityBlur } from "./windows/window-opacity.js";
import { getSettingsValue } from "./handlers/settings.js";
import { initPaths } from "./services/paths.js";
import { initGenerateConversationsDir, recoverOrphanedGenerations } from "./services/generate-conversations-service.js";
import { initSettings } from "./handlers/settings.js";
import { watchStories, stopWatchingStories } from "./services/stories-service.js";
import { listRuns, buildLastRunMap } from "./services/run-service.js";
import { recoverOrphanedRuns } from "./services/run-recovery.js";
import { logger } from "./logger.js";
import { applyAppBranding, getAppIcon } from "./app-icon.js";
import { checkForUpdatesManually, initAutoUpdates } from "./services/auto-update-service.js";
import { startScheduleWatcher, stopScheduleWatcher } from "./services/schedule-service.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.setName("Story Studio");

protocol.registerSchemesAsPrivileged([
  {
    scheme: "story-screenshot",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

let mainWindow: BrowserWindow | null = null;

async function createMainWindow(): Promise<void> {
  if (mainWindow && !mainWindow.isDestroyed()) {
    logger.debug("main", "Main window already exists, skipping creation");
    return;
  }

  const packageJsonPath = path.join(__dirname, "..", "..", "package.json");
  let windowTitle = "Story Studio";

  try {
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(await fs.promises.readFile(packageJsonPath, "utf-8"));
      windowTitle = packageJson.productName || packageJson.name || windowTitle;
    }
  } catch {
    // use default
  }

  const { options: windowStateOptions, isMaximized } = getMainWindowStateOptions();

  mainWindow = new BrowserWindow({
    ...windowStateOptions,
    title: windowTitle,
    icon: getAppIcon(),
    show: false,
    backgroundColor: "#141416",
    ...getMacWindowChromeOptions(),
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  applyMacWindowChrome(mainWindow);

  trackMainWindowState(mainWindow);

  mainWindow.once("ready-to-show", () => {
    if (isMaximized) {
      mainWindow?.maximize();
    }
    mainWindow?.show();
  });

  mainWindow.on("closed", () => {
    setMainWindow(null);
    mainWindow = null;
  });

  setMainWindow(mainWindow);
  disableReloadShortcut(mainWindow.webContents);
  applyDefaultZoom(mainWindow.webContents);

  const load = getMainWindowLoadOptions();
  logger.info("main", "Loading main window", load);

  if ("url" in load) {
    await mainWindow.loadURL(load.url);
  } else {
    await mainWindow.loadFile(load.file, load.query ? { query: load.query } : undefined);
  }

  applyWindowOpacityBlur(getSettingsValue());
}

function setupApplicationMenu(): void {
  const menu = Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        {
          label: "Settings…",
          accelerator: "CommandOrControl+,",
          click: () => {
            navigateMainWindow("/settings");
          },
        },
        {
          label: "Check for Updates…",
          click: () => {
            void checkForUpdatesManually();
          },
        },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { role: "fileMenu" },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
  ]);
  Menu.setApplicationMenu(menu);
}

app.on("window-all-closed", () => {
  app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createMainWindow();
  } else {
    mainWindow?.show();
  }
});

app.on("before-quit", () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    saveMainWindowState(mainWindow);
  }
  stopWatchingStories();
  stopScheduleWatcher();
});

app.whenReady().then(async () => {
  applyAppBranding();
  protocol.handle("story-screenshot", (request) => {
    const url = new URL(request.url);
    const filePath = url.searchParams.get("file");
    if (!filePath) {
      return new Response("Missing file parameter", { status: 400 });
    }
    return net.fetch(`file://${path.normalize(filePath)}`);
  });

  await initPaths();
  await initGenerateConversationsDir();
  await recoverOrphanedGenerations();
  await initSettings();
  registerHandlers();
  setupApplicationMenu();
  initAutoUpdates();

  await recoverOrphanedRuns();

  const runs = await listRuns();
  watchStories(buildLastRunMap(runs));
  startScheduleWatcher();

  await createMainWindow();
});
