// ============================================================================
// One-time local install of the pinned @playwright/mcp package.
//
// Story runs launch the Playwright MCP server on every run. Historically the
// launch command was `npx -y @playwright/mcp@<pinned> …`, and the `-y` flag
// makes npx re-resolve the package against the registry on EVERY launch. On a
// machine whose npm `_npx` cache was cleared/evicted that means a network
// download before the browser is usable — and the run pays for it twice (the
// preflight warm-up and Codex's own MCP launch). That is the "slow to start"
// symptom.
//
// Instead we install the pinned package ONCE into an app-managed directory and
// let runs invoke its CLI by absolute path via `node <cli>` — no registry
// round-trip. If the install is missing/fails, callers fall back to the old
// `npx -y` behaviour, so this is a pure speed-up with no reliability regression.
// ============================================================================

import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync } from "fs";
import * as fs from "fs/promises";
import * as path from "path";
import { app } from "../electron-api.js";
import { PLAYWRIGHT_MCP_VERSION, playwrightMcpPackageSpec } from "./setup-versions.js";
import { buildPlaywrightEnv, resolveNpxCommand } from "./playwright-runtime.js";

const execFileAsync = promisify(execFile);

/** App-managed directory that holds the pinned @playwright/mcp install. */
export function getMcpInstallDir(): string {
  return path.join(app.getPath("userData"), "playwright-mcp");
}

function mcpPackageJsonPath(): string {
  return path.join(getMcpInstallDir(), "node_modules", "@playwright", "mcp", "package.json");
}

/**
 * Absolute path to the installed @playwright/mcp CLI entry, or null when the
 * pinned version is not installed. The bin path is read from the package's own
 * package.json so we never hard-code an internal filename.
 */
export async function resolveInstalledMcpCli(): Promise<string | null> {
  try {
    const raw = await fs.readFile(mcpPackageJsonPath(), "utf-8");
    const pkg = JSON.parse(raw) as {
      version?: string;
      bin?: string | Record<string, string>;
    };
    if (pkg.version !== PLAYWRIGHT_MCP_VERSION) return null;

    const pkgDir = path.dirname(mcpPackageJsonPath());
    let binRel: string | undefined;
    if (typeof pkg.bin === "string") {
      binRel = pkg.bin;
    } else if (pkg.bin && typeof pkg.bin === "object") {
      binRel = pkg.bin["mcp-server-playwright"] ?? Object.values(pkg.bin)[0];
    }
    if (!binRel) return null;

    const cli = path.join(pkgDir, binRel);
    return existsSync(cli) ? cli : null;
  } catch {
    return null;
  }
}

/** Resolve the absolute `node` binary that sits next to the resolved npx. */
export async function resolveNodeCommand(): Promise<string | null> {
  const npx = await resolveNpxCommand();
  if (npx && npx !== "npx" && path.isAbsolute(npx)) {
    const node = path.join(path.dirname(npx), "node");
    if (existsSync(node)) return node;
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
 * Ensure @playwright/mcp@<pinned> is installed in the app-managed dir. Returns
 * the CLI path on success, or null on failure (callers fall back to npx). Safe
 * to call concurrently — a single install is shared across callers.
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
          env: buildPlaywrightEnv(),
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
