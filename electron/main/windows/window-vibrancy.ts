import type { BrowserWindow } from "electron";

/** under-window blurs the desktop; paired with ~84% tint for balance of dark + glass. */
const CURSOR_VIBRANCY_TYPE = "under-window" as const;

const DEFAULT_WINDOW_BG = "#141416";

export function setSidebarVibrancy(win: BrowserWindow, enabled: boolean): void {
  if (process.platform !== "darwin") return;
  if (win.isDestroyed()) return;

  if (enabled) {
    win.setBackgroundColor("#00000000");
    win.setVibrancy(CURSOR_VIBRANCY_TYPE);
  } else {
    win.setVibrancy(null);
    win.setBackgroundColor(DEFAULT_WINDOW_BG);
  }
}

export function isCursorColorTheme(themeId: string): boolean {
  return themeId === "cursor";
}
