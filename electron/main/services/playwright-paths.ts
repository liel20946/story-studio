import { existsSync, readdirSync } from "fs";
import * as path from "path";
import * as os from "os";
import { app } from "../electron-api.js";

/** extraResources dest names — keep in sync with package.json build.extraResources. */
export const BUNDLED_MCP_RESOURCE = "playwright-mcp";
export const BUNDLED_BROWSERS_RESOURCE = "ms-playwright";

function packagedResource(name: string): string | null {
  try {
    if (typeof process.resourcesPath === "string" && process.resourcesPath) {
      return path.join(process.resourcesPath, name);
    }
  } catch {
    // not Electron
  }
  return null;
}

function unpackagedResource(name: string): string[] {
  const candidates: string[] = [];
  const cwd = process.cwd();
  candidates.push(path.join(cwd, "resources", name));
  try {
    const appPath = app.getAppPath();
    candidates.push(path.join(appPath, "resources", name));
    candidates.push(path.join(appPath, "..", "resources", name));
  } catch {
    // app not ready
  }
  return candidates;
}

/** First existing directory for a bundled extraResource, or null. */
export function resolveBundledResourceDir(name: string): string | null {
  const candidates = [packagedResource(name), ...unpackagedResource(name)].filter(
    (dir): dir is string => Boolean(dir),
  );
  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  return null;
}

export function getBundledMcpDir(): string | null {
  const dir = resolveBundledResourceDir(BUNDLED_MCP_RESOURCE);
  if (!dir) return null;
  const pkg = path.join(dir, "node_modules", "@playwright", "mcp", "package.json");
  return existsSync(pkg) ? dir : null;
}

export function getBundledBrowsersDir(): string | null {
  return resolveBundledResourceDir(BUNDLED_BROWSERS_RESOURCE);
}

export function getUserDataBrowsersDir(): string {
  return path.join(app.getPath("userData"), "ms-playwright");
}

export function getUserDataMcpDir(): string {
  return path.join(app.getPath("userData"), "playwright-mcp");
}

/** Playwright's historical default cache (pre-bundling). */
export function getLegacyPlaywrightBrowsersDir(): string {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Caches", "ms-playwright");
  }
  if (process.platform === "linux") {
    const xdg = process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache");
    return path.join(xdg, "ms-playwright");
  }
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
    return path.join(local, "ms-playwright");
  }
  return path.join(os.homedir(), ".cache", "ms-playwright");
}

/**
 * Directories to search for a Chromium build, preferred first.
 * Env override (PLAYWRIGHT_BROWSERS_PATH) is handled by the caller.
 */
export function getPlaywrightBrowsersSearchDirs(): string[] {
  const dirs: string[] = [];
  const bundled = getBundledBrowsersDir();
  if (bundled) dirs.push(bundled);
  try {
    dirs.push(getUserDataBrowsersDir());
  } catch {
    // userData unavailable
  }
  dirs.push(getLegacyPlaywrightBrowsersDir());
  return [...new Set(dirs)];
}

/**
 * Directory Playwright should use for browsers.
 * Prefer a location that already has Chromium; otherwise the bundled dir
 * (packaged) or userData (dev / fallback install target).
 */
export function resolvePlaywrightBrowsersPath(): string {
  const envPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (envPath && envPath !== "0") return envPath;

  for (const dir of getPlaywrightBrowsersSearchDirs()) {
    if (dirHasChromium(dir)) return dir;
  }

  const bundled = getBundledBrowsersDir();
  if (bundled) return bundled;
  try {
    return getUserDataBrowsersDir();
  } catch {
    return getLegacyPlaywrightBrowsersDir();
  }
}

/** Writable install target — never the signed .app extraResources tree. */
export function getPlaywrightBrowsersInstallDir(): string {
  const envPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (envPath && envPath !== "0") return envPath;
  return getUserDataBrowsersDir();
}

const CHROMIUM_EXECUTABLE_SUFFIX: Record<string, string[][]> = {
  darwin: [
    ["chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"],
    ["chrome-mac-arm64", "Chromium.app", "Contents", "MacOS", "Chromium"],
    ["chrome-mac-x64", "Chromium.app", "Contents", "MacOS", "Chromium"],
  ],
  linux: [
    ["chrome-linux", "chrome"],
    ["chrome-linux64", "chrome"],
    ["chrome-headless-shell-linux64", "chrome-headless-shell"],
  ],
  win32: [
    ["chrome-win", "chrome.exe"],
    ["chrome-win64", "chrome.exe"],
  ],
};

export function dirHasChromium(cacheDir: string): boolean {
  if (!existsSync(cacheDir)) return false;
  const suffixList = CHROMIUM_EXECUTABLE_SUFFIX[process.platform];
  if (!suffixList) return false;
  try {
    const entries = readdirSync(cacheDir);
    for (const entry of entries) {
      if (!/chromium/i.test(entry)) continue;
      for (const suffix of suffixList) {
        if (existsSync(path.join(cacheDir, entry, ...suffix))) return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}
