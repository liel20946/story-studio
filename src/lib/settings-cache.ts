import type { AppSettings } from "./contract-types";
import { normalizeAppSettings } from "./app-settings";

let cachedAppSettings: AppSettings | null = null;

export function getCachedAppSettings(): AppSettings | null {
  return cachedAppSettings;
}

export function setCachedAppSettings(
  settings: Partial<AppSettings> | AppSettings,
): AppSettings {
  cachedAppSettings = normalizeAppSettings({
    ...(cachedAppSettings ?? {}),
    ...settings,
  });
  window.dispatchEvent(new CustomEvent("story-studio:settings-changed"));
  return cachedAppSettings;
}

export function clearCachedAppSettings(): void {
  cachedAppSettings = null;
}
