/**
 * Handler Registration
 *
 * Register all your IPC handlers here
 */

import * as path from "path";
import { fileURLToPath } from "url";

import { appHandlers } from "./app.js";
import { getSettingsWindow } from "../windows/settings-window.js";
import { navigateMainWindow } from "../windows/main-window.js";

import { ipcMain, clipboard } from "../electron-api.js";
import { logger } from "../logger.js";

import { registerStoriesHandlers } from "./stories.js";
import { registerRecordingHandlers } from "./recording.js";
import { registerRunsHandlers } from "./runs.js";
import { registerSettingsHandlers } from "./settings.js";
import { registerDraftHandlers, registerMigrationHandlers } from "./drafts.js";
import { registerGenerateHandlers } from "./generate.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function registerHandlers(): void {
  logger.info("handlers", "Registering IPC handlers...");

  // Register app handlers using ipcMain API
  ipcMain.handle("app:getInfo", async (_event) => {
    return await appHandlers.getInfo();
  });

  // Return the app root path (packaged resources directory).
  // __dirname = build/main, so two levels up is the app root
  ipcMain.handle("app:getProjectPath", async () => {
    return path.join(__dirname, "..", "..");
  });

  // In-app settings — navigate the main window instead of opening a separate one.
  ipcMain.handle("window:openSettings", async () => {
    navigateMainWindow("/settings");
  });

  ipcMain.handle("window:closeSettings", async (_event) => {
    getSettingsWindow()?.close();
  });

  // Copy arbitrary text to the system clipboard (used by the variable-table
  // copy buttons in the story detail view). NOTE: the channel is app-namespaced
  // ("app:copyText") because the native API already registers "clipboard:*"
  // handlers — reusing that name throws "second handler" and crashes startup.
  ipcMain.handle("app:copyText", async (_event, params: unknown) => {
    if (
      typeof params !== "object" ||
      params === null ||
      typeof (params as Record<string, unknown>)["text"] !== "string"
    ) {
      throw new Error("app:copyText requires { text: string }");
    }
    const { text } = params as { text: string };
    clipboard.writeText(text);
    return { ok: true as const };
  });

  // Story Studio domain handlers
  registerStoriesHandlers();
  registerRecordingHandlers();
  registerRunsHandlers();
  registerSettingsHandlers();
  registerDraftHandlers();
  registerMigrationHandlers();
  registerGenerateHandlers();

  logger.info("handlers", "✓ IPC handlers registered");
}
