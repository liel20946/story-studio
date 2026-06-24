import { BrowserWindow } from "./electron-api.js";

/** Broadcast an IPC event to every open renderer window. */
export function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
}
