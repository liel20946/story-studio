import path from "path";
import { existsSync } from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function getPreloadPath(): string {
  const js = path.join(__dirname, "../preload/index.js");
  const mjs = path.join(__dirname, "../preload/index.mjs");
  if (existsSync(mjs)) return mjs;
  if (existsSync(js)) return js;
  return mjs;
}

export function getRendererHtmlPath(): string {
  const flat = path.join(__dirname, "../renderer/index.html");
  const nested = path.join(__dirname, "../renderer/renderer/index.html");
  if (existsSync(flat)) return flat;
  if (existsSync(nested)) return nested;
  return flat;
}

export function getMainWindowLoadOptions():
  | { url: string }
  | { file: string; query?: Record<string, string> } {
  if (process.env.ELECTRON_RENDERER_URL) {
    return { url: `${process.env.ELECTRON_RENDERER_URL}/index.html` };
  }
  return { file: getRendererHtmlPath() };
}

export function getSettingsWindowLoadOptions():
  | { url: string }
  | { file: string; query?: Record<string, string> } {
  if (process.env.ELECTRON_RENDERER_URL) {
    return {
      url: `${process.env.ELECTRON_RENDERER_URL}/index.html?window=settings`,
    };
  }
  return { file: getRendererHtmlPath(), query: { window: "settings" } };
}
