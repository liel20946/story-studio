import * as fs from "fs/promises";
import { existsSync } from "fs";
import * as os from "os";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { app } from "../electron-api.js";

const execFileAsync = promisify(execFile);

const CHROMIUM_EXECUTABLE_SUFFIX: Record<string, string[]> = {
  darwin: ["chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"],
  linux: ["chrome-linux", "chrome"],
  win32: ["chrome-win", "chrome.exe"],
};

function getPlaywrightBrowsersCacheDir(): string {
  const envPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (envPath === "0") {
    return path.join(process.cwd(), "node_modules", "playwright-core", ".local-browsers");
  }
  if (envPath) return envPath;
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

/** True when Playwright's bundled Chromium is on disk (required for headless MCP runs). */
export async function isPlaywrightChromiumInstalled(): Promise<boolean> {
  const suffix = CHROMIUM_EXECUTABLE_SUFFIX[process.platform];
  if (!suffix) return false;

  const cacheDir = getPlaywrightBrowsersCacheDir();
  try {
    const entries = await fs.readdir(cacheDir);
    const chromiumDirs = entries.filter((entry) => /^chromium-\d+/.test(entry));
    for (const chromiumDir of chromiumDirs) {
      const execPath = path.join(cacheDir, chromiumDir, ...suffix);
      try {
        await fs.access(execPath);
        return true;
      } catch {
        // try next revision directory
      }
    }
    return false;
  } catch {
    return false;
  }
}

export function headlessPlaywrightMissingMessage(): string {
  return (
    "Playwright Chromium is not installed, so headless story runs cannot start a browser. " +
    "Open Record Story and click Install Chromium, or run: npx playwright install chromium"
  );
}

export interface PlaywrightInvocation {
  command: string;
  prefixArgs: string[];
  useElectronAsNode: boolean;
}

function findPlaywrightCli(): string | null {
  const candidates = [
    path.join(process.cwd(), "node_modules", "playwright", "cli.js"),
    path.join(app.getAppPath(), "node_modules", "playwright", "cli.js"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function resolvePlaywrightInvocation(): PlaywrightInvocation {
  const cli = findPlaywrightCli();
  if (cli) {
    return {
      command: process.execPath,
      prefixArgs: [cli],
      useElectronAsNode: true,
    };
  }
  return {
    command: "npx",
    prefixArgs: ["playwright"],
    useElectronAsNode: false,
  };
}

/** PATH/HOME env for Playwright CLI, npx, and MCP child processes. */
export function buildPlaywrightEnv(opts?: { electronAsNode?: boolean }): NodeJS.ProcessEnv {
  const home = os.homedir();
  const extraPath = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    path.join(home, ".local/bin"),
    path.join(home, ".npm-global/bin"),
    path.dirname(process.execPath),
  ].join(":");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    PATH: `${extraPath}:${process.env.PATH ?? ""}`,
  };
  if (opts?.electronAsNode) {
    env.ELECTRON_RUN_AS_NODE = "1";
  }
  return env;
}

/** Resolve absolute path to npx so MCP servers start under Electron/Codex/Claude. */
let cachedNpxPath: string | null | undefined;
export async function resolveNpxCommand(): Promise<string> {
  if (cachedNpxPath !== undefined) return cachedNpxPath ?? "npx";
  const env = buildPlaywrightEnv();
  const candidates = [
    "/opt/homebrew/bin/npx",
    "/usr/local/bin/npx",
    path.join(os.homedir(), ".nvm/versions/node/v20.17.0/bin/npx"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      cachedNpxPath = candidate;
      return candidate;
    }
  }
  try {
    const { stdout } = await execFileAsync("which", ["npx"], {
      env,
      timeout: 15_000,
      maxBuffer: 4096,
    });
    const resolved = stdout.trim().split("\n")[0]?.trim();
    if (resolved) {
      cachedNpxPath = resolved;
      return resolved;
    }
  } catch {
    // fall through
  }
  cachedNpxPath = null;
  return "npx";
}

/** Install Playwright's bundled Chromium (required for headless MCP). */
export async function installPlaywrightChromium(): Promise<{ ok: boolean; error?: string }> {
  const playwright = resolvePlaywrightInvocation();
  const installArgs = [...playwright.prefixArgs, "install", "chromium"];
  console.log("[playwright] installing chromium via", playwright.command, installArgs.join(" "));
  try {
    await execFileAsync(playwright.command, installArgs, {
      env: buildPlaywrightEnv({ electronAsNode: playwright.useElectronAsNode }),
      timeout: 5 * 60_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[playwright] chromium install failed", msg);
    return { ok: false, error: msg };
  }
}
