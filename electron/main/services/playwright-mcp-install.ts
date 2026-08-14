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
import { buildPlaywrightEnv, resolveElectronAsNode, resolveNpxCommand } from "./playwright-runtime.js";
import { getBundledMcpDir, getSpacelessMcpDir, getUserDataMcpDir } from "./playwright-paths.js";

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

/**
 * Copy the bundled MCP to `~/.story-studio/playwright-mcp` so Claude Code's
 * MCP spawn never sees a path with spaces (`Story Studio.app`).
 */
export async function ensureSpacelessMcpCli(): Promise<string | null> {
  const dest = getSpacelessMcpDir();
  const existing = await cliFromHostDir(dest);
  if (existing) return existing;

  const bundled = getBundledMcpDir();
  const source = bundled ?? getMcpInstallDir();
  const sourceCli = await cliFromHostDir(source);
  if (!sourceCli) return null;
  if (!source.includes(" ")) return sourceCli;

  try {
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.rm(dest, { recursive: true, force: true });
    await fs.symlink(source, dest);
    console.log("[playwright] linked MCP to spaceless dir", { dest, source });
  } catch (linkErr) {
    try {
      await fs.cp(source, dest, { recursive: true, dereference: true });
      console.log("[playwright] copied MCP to spaceless dir", { dest });
    } catch (err) {
      console.warn(
        "[playwright] spaceless MCP copy failed",
        err instanceof Error ? err.message : String(err),
      );
      return sourceCli;
    }
  }
  return (await cliFromHostDir(dest)) ?? sourceCli;
}

/** Shell wrapper so Claude never uses `Story Studio.app` as the MCP `command`. */
export async function writeElectronMcpWrapper(): Promise<string> {
  const dir = path.join(path.dirname(getSpacelessMcpDir()));
  await fs.mkdir(dir, { recursive: true });
  const wrapper = path.join(dir, "mcp-run");
  const electron = resolveElectronAsNode();
  const body = `#!/bin/sh\nexport ELECTRON_RUN_AS_NODE=1\nexec ${JSON.stringify(electron)} "$@"\n`;
  await fs.writeFile(wrapper, body, "utf-8");
  await fs.chmod(wrapper, 0o755);
  return wrapper;
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
