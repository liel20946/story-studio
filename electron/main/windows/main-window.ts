import type { BrowserWindow } from "electron";

let mainWindow: BrowserWindow | null = null;

export function setMainWindow(win: BrowserWindow | null): void {
  mainWindow = win;
}

export function getMainWindow(): BrowserWindow | null {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  return mainWindow;
}

export function navigateMainWindow(path: string): void {
  const win = getMainWindow();
  if (!win) return;
  win.show();
  win.focus();
  win.webContents.send("app:navigate", { path });
}
