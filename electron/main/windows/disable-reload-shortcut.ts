import type { WebContents } from "electron";

/** Prevents Cmd/Ctrl+R from reloading the window (Shift+Cmd+R is left to the app). */
export function disableReloadShortcut(webContents: WebContents): void {
  webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    if (input.key.toLowerCase() !== "r") return;
    if (!input.meta && !input.control) return;
    if (input.alt || input.shift) return;
    event.preventDefault();
  });
}
