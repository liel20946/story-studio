import type { BrowserWindow, BrowserWindowConstructorOptions } from "electron";

export const MAC_WINDOW_CHROME_QUERY = "macWindowChrome";

/** macOS-only: transparent shell so the OS clips content to native rounded corners. */
export function getMacWindowChromeOptions(): Partial<BrowserWindowConstructorOptions> {
  if (process.platform !== "darwin") return {};
  return {
    transparent: true,
    backgroundColor: "#00000000",
    roundedCorners: true,
    visualEffectState: "active",
    // Title bar is hidden; native traffic lights are suppressed in applyMacWindowChrome.
    titleBarStyle: "hidden",
  };
}

/** Hide native traffic lights — we render custom ones that scale with renderer zoom. */
export function applyMacWindowChrome(win: BrowserWindow): void {
  if (process.platform !== "darwin") return;
  const hideNativeButtons = () => {
    win.setWindowButtonVisibility(false);
  };
  hideNativeButtons();
  win.once("ready-to-show", hideNativeButtons);

  // Keep the Chromium content view clipped to the same curve as the OS window.
  // Electron 38+ uses macOS Tahoe’s regular-window radius; CSS alone cannot enlarge
  // the native window silhouette (that comes from the Electron/macOS SDK).
  try {
    win.contentView?.setBorderRadius?.(18);
  } catch {
    // Older Electron builds without contentView.setBorderRadius — ignore.
  }
}

export function withMacWindowChromeQuery(
  query?: Record<string, string>,
): Record<string, string> | undefined {
  if (process.platform !== "darwin") return query;
  return { ...query, [MAC_WINDOW_CHROME_QUERY]: "1" };
}
