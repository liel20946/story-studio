import type { WebContents } from "electron";

/** Default renderer zoom — matches comfortable Codex-like density without manual zoom. */
export const DEFAULT_ZOOM_FACTOR = 1.15;

export function applyDefaultZoom(webContents: WebContents): void {
  webContents.once("did-finish-load", () => {
    webContents.setZoomFactor(DEFAULT_ZOOM_FACTOR);
  });
}
