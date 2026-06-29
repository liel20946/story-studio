import { ipcMain } from "../electron-api.js";
import {
  checkRecordingAvailability,
  installBrowser,
  startRecording,
  cancelRecording,
  abortRecording,
} from "../services/recording-service.js";
import { getSettingsValue } from "./settings.js";

export function registerRecordingHandlers(): void {
  ipcMain.handle("recording:check", async () => {
    const settings = getSettingsValue();
    return checkRecordingAvailability(settings);
  });

  ipcMain.handle("recording:installBrowser", async () => {
    return installBrowser();
  });

  ipcMain.handle("recording:start", async (_event, params: unknown) => {
    if (
      typeof params !== "object" ||
      params === null ||
      typeof (params as Record<string, unknown>)["name"] !== "string" ||
      typeof (params as Record<string, unknown>)["url"] !== "string"
    ) {
      throw new Error(
        "recording:start requires { name: string; url: string; overwriteStoryKey?: string }",
      );
    }
    const { name, url, overwriteStoryKey } = params as {
      name: string;
      url: string;
      overwriteStoryKey?: string;
    };
    const settings = getSettingsValue();
    return startRecording(name, url, settings, overwriteStoryKey);
  });

  ipcMain.handle("recording:cancel", async () => {
    await cancelRecording();
    return { ok: true as const };
  });

  ipcMain.handle("recording:abort", async () => {
    await abortRecording();
    return { ok: true as const };
  });
}
