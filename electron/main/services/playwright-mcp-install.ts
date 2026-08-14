// ============================================================================
// Resolve (and if needed, install) the pinned @playwright/mcp package.
//
// Packaged builds ship the MCP under extraResources/playwright-mcp. Dev/fallback
// still installs once into userData and lets runs invoke the CLI by absolute
// path (system node, else Electron-as-Node) — no per-run `npx -y` round-trip.
// ============================================================================

import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync } from "fs";
import * as fs from "fs/promises";
import * as path from "path";
import { PLAYWRIGHT_MCP_VERSION, playwrightMcpPackageSpec } from "./setup-versions.js";
import { buildPlaywrightEnv, resolveNpxCommand } from "./playwright-runtime.js";
import { getBundledMcpDir, getUserDataMcpDir } from "./playwright-paths.js";

const execFileAsync = promisify(execFile);

/** App-managed directory that holds a fallback @playwright/mcp install. */
export function getMcpInstallDir(): string {
  return getUserDataMcpDir();
}

function mcpPackageJsonPath(hostDir: string): string {
  return path.join(hostDir, "node_modules", "@playwright", "mcp", "package.json");
}

async function cliFromHostDir(hostDir: string): Promise<string | null> {
  try {
    const pkgPath = mcpPackageJsonPath(hostDir);
    const raw = await fs.readFile(pkgPath, "utf-8");
    const pkg = JSON.parse(raw) as {
      version?: string;
      bin?: string | Record<string, string>;
    };
    if (pkg.version !== PLAYWRIGHT_MCP_VERSION) return null;

    const pkgDir = path.dirname(pkgPath);
    let binRel: string | undefined;
    if (typeof pkg.bin === "string") {
      binRel = pkg.bin;
    } else if (pkg.bin && typeof pkg.bin === "object") {
      binRel =
        pkg.bin["playwright-mcp"] ??
        pkg.bin["mcp-server-playwright"] ??
        Object.values(pkg.bin)[0];
    }
    if (!binRel) return null;

    const cli = path.join(pkgDir, binRel);
    return existsSync(cli) ? cli : null;
  } catch {
    return null;
  }
}

export function isPlaywrightMcpBundled(): boolean {
  return Boolean(getBundledMcpDir());
}

/**
 * Absolute path to the installed @playwright/mcp CLI entry, or null when the
 * pinned version is not installed. Prefers the extraResources copy shipped
 * with the app, then the userData fallback install.
 */
export async function resolveInstalledMcpCli(): Promise<string | null> {
  const bundled = getBundledMcpDir();
  if (bundled) {
    const cli = await cliFromHostDir(bundled);
    if (cli) return cli;
  }
  return cliFromHostDir(getMcpInstallDir());
}

/** Electron binary used as Node so MCP does not require a system Node install. */
export function resolveElectronAsNode(): string {
  return process.execPath;
}

/**
 * Launch the MCP CLI via `/usr/bin/env ELECTRON_RUN_AS_NODE=1 <electron> <cli>`.
 *
 * Claude Code (an Electron app) strips `ELECTRON_RUN_AS_NODE` from MCP child
 * env, so putting the Electron binary in `command` makes it boot as a second
 * Story Studio instance and the run dies immediately. Baking the flag into
 * argv survives that sanitizer, and `command` has no spaces.
 */
export function electronAsNodeLaunch(
  cli: string,
  extraArgs: string[],
): { command: string; args: string[] } {
  return {
    command: "/usr/bin/env",
    args: ["ELECTRON_RUN_AS_NODE=1", resolveElectronAsNode(), cli, ...extraArgs],
  };
}

/** Resolve an absolute `node` binary (preferred MCP launcher for Claude Code). */
export async function resolveNodeCommand(): Promise<string | null> {
  const npx = await resolveNpxCommand();
  if (npx && npx !== "npx" && path.isAbsolute(npx)) {
    const node = path.join(path.dirname(npx), "node");
    if (existsSync(node)) return node;
  }
  for (const candidate of ["/opt/homebrew/bin/node", "/usr/local/bin/node"]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Resolve the absolute `npm` binary that sits next to the resolved npx. */
function resolveNpmCommand(npxPath: string): string {
  if (npxPath && npxPath !== "npx" && path.isAbsolute(npxPath)) {
    const npm = path.join(path.dirname(npxPath), "npm");
    if (existsSync(npm)) return npm;
  }
  return "npm";
}

let _installInFlight: Promise<string | null> | null = null;

/**
 * Ensure @playwright/mcp@<pinned> is available. Returns the CLI path on success,
 * or null on failure (callers fall back to npx). Prefers the shipped extraResources
 * copy; only npm-installs into userData when that is missing.
 */
export async function ensurePlaywrightMcpInstalled(): Promise<string | null> {
  const existing = await resolveInstalledMcpCli();
  if (existing) return existing;
  if (_installInFlight) return _installInFlight;

  _installInFlight = (async () => {
    const dir = getMcpInstallDir();
    try {
      await fs.mkdir(dir, { recursive: true });
      // A minimal package.json keeps npm from walking up to an unrelated project.
      await fs.writeFile(
        path.join(dir, "package.json"),
        JSON.stringify({ name: "story-studio-mcp-host", private: true }, null, 2),
        "utf-8",
      );
      const npx = await resolveNpxCommand();
      const npm = resolveNpmCommand(npx);
      console.log("[playwright] installing MCP locally", { dir, npm });
      await execFileAsync(
        npm,
        [
          "install",
          playwrightMcpPackageSpec(),
          "--prefix",
          dir,
          "--no-save",
          "--no-audit",
          "--no-fund",
          "--loglevel",
          "error",
        ],
        {
          env: {
            ...buildPlaywrightEnv(),
            PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
          },
          timeout: 3 * 60_000,
          maxBuffer: 10 * 1024 * 1024,
        },
      );
    } catch (err) {
      console.warn(
        "[playwright] local MCP install failed — falling back to npx",
        err instanceof Error ? err.message : String(err),
      );
      return null;
    }
    return resolveInstalledMcpCli();
  })().finally(() => {
    _installInFlight = null;
  });

  return _installInFlight;
}
