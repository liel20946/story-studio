import { BrowserWindow, nativeTheme } from "../electron-api.js";
import type { AppSettings } from "../services/contract-types.js";

export function effectiveWindowOpacity(settings: AppSettings): number {
  const mode =
    settings.theme === "system"
      ? nativeTheme.shouldUseDarkColors
        ? "dark"
        : "light"
      : settings.theme;
  return mode === "light"
    ? settings.colorThemeOpacityLight
    : settings.colorThemeOpacityDark;
}

/** macOS: native under-window blur. Other platforms: CSS backdrop-filter in the renderer. */
export function applyWindowOpacityBlur(settings: AppSettings): void {
  previewWindowOpacityBlur(effectiveWindowOpacity(settings));
}

export function previewWindowOpacityBlur(opacity: number): void {
  if (process.platform !== "darwin") return;
  const clamped = Math.min(100, Math.max(0, Math.round(opacity)));
  const vibrancy = clamped < 100 ? "under-window" : null;
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.setVibrancy(vibrancy);
    }
  }
}

export function registerWindowOpacityListeners(
  getSettings: () => AppSettings,
): void {
  nativeTheme.on("updated", () => {
    const settings = getSettings();
    if (settings.theme === "system") {
      applyWindowOpacityBlur(settings);
    }
  });
}
