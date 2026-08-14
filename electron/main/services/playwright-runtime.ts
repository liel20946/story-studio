import * as fs from "fs/promises";
import { existsSync } from "fs";
import * as os from "os";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { app } from "../electron-api.js";
import {
  dirHasChromium,
  getBundledBrowsersDir,
  getBundledMcpDir,
  getPlaywrightBrowsersInstallDir,
  getPlaywrightBrowsersSearchDirs,
  getUserDataMcpDir,
  resolvePlaywrightBrowsersPath,
} from "./playwright-paths.js";

const execFileAsync = promisify(execFile);

/** True when Playwright's bundled Chromium is on disk (required for headless MCP runs). */
export async function isPlaywrightChromiumInstalled(): Promise<boolean> {
  const envPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (envPath && envPath !== "0" && dirHasChromium(envPath)) return true;
  if (envPath === "0") {
    return dirHasChromium(
      path.join(process.cwd(), "node_modules", "playwright-core", ".local-browsers"),
    );
  }
  return getPlaywrightBrowsersSearchDirs().some((dir) => dirHasChromium(dir));
}

export function isPlaywrightChromiumBundled(): boolean {
  const bundled = getBundledBrowsersDir();
  return Boolean(bundled && dirHasChromium(bundled));
}

export function headlessPlaywrightMissingMessage(): string {
  return (
    "Playwright Chromium is not installed, so headless story runs cannot start a browser. " +
    "Open Record Story and click Install Chromium, or reinstall Story Studio."
  );
}

export interface PlaywrightInvocation {
  command: string;
  prefixArgs: string[];
  useElectronAsNode: boolean;
}

/** Electron binary used as Node so Playwright/MCP do not require a system Node install. */
export function resolveElectronAsNode(): string {
  return process.execPath;
}

/**
 * Run a JS CLI via `/usr/bin/env ELECTRON_RUN_AS_NODE=1 <electron> <cli> …`.
 * Survives hosts that strip ELECTRON_RUN_AS_NODE from env, and avoids a
 * `command` path with spaces (`Story Studio.app`).
 */
export function electronAsNodeLaunch(
  cli: string,
  extraArgs: string[] = [],
): { command: string; args: string[] } {
  return {
    command: "/usr/bin/env",
    args: ["ELECTRON_RUN_AS_NODE=1", resolveElectronAsNode(), cli, ...extraArgs],
  };
}

const NODE_CANDIDATES = ["/opt/homebrew/bin/node", "/usr/local/bin/node"];

export function resolveNodeCommandSync(): string | null {
  for (const candidate of NODE_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Resolve an absolute `node` binary (preferred launcher for Claude Code + codegen). */
export async function resolveNodeCommand(): Promise<string | null> {
  const npx = await resolveNpxCommand();
  if (npx && npx !== "npx" && path.isAbsolute(npx)) {
    const node = path.join(path.dirname(npx), "node");
    if (existsSync(node)) return node;
  }
  return resolveNodeCommandSync();
}

function findPlaywrightCli(): string | null {
  const candidates = [
    path.join(process.cwd(), "node_modules", "playwright", "cli.js"),
    path.join(app.getAppPath(), "node_modules", "playwright", "cli.js"),
  ];
  const bundled = getBundledMcpDir();
  if (bundled) {
    candidates.push(path.join(bundled, "node_modules", "playwright", "cli.js"));
  }
  try {
    candidates.push(path.join(getUserDataMcpDir(), "node_modules", "playwright", "cli.js"));
  } catch {
    // userData unavailable
  }
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function resolvePlaywrightInvocation(): PlaywrightInvocation {
  const cli = findPlaywrightCli();
  if (cli) {
    const node = resolveNodeCommandSync();
    if (node) {
      return { command: node, prefixArgs: [cli], useElectronAsNode: false };
    }
    const launch = electronAsNodeLaunch(cli);
    return {
      command: launch.command,
      prefixArgs: launch.args,
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
    PLAYWRIGHT_BROWSERS_PATH: resolvePlaywrightBrowsersPath(),
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
  if (await isPlaywrightChromiumInstalled()) {
    return { ok: true };
  }
  const playwright = resolvePlaywrightInvocation();
  const installDir = getPlaywrightBrowsersInstallDir();
  await fs.mkdir(installDir, { recursive: true });
  const installArgs = [...playwright.prefixArgs, "install", "chromium"];
  console.log("[playwright] installing chromium via", playwright.command, installArgs.join(" "), "→", installDir);
  try {
    await execFileAsync(playwright.command, installArgs, {
      env: {
        ...buildPlaywrightEnv({ electronAsNode: playwright.useElectronAsNode }),
        PLAYWRIGHT_BROWSERS_PATH: installDir,
      },
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
