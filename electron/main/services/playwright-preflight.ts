import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { existsSync } from "fs";
import * as path from "path";
import { app } from "../electron-api.js";
import { playwrightMcpPackageSpec } from "./setup-versions.js";
import {
  buildPlaywrightEnv,
  installPlaywrightChromium,
  isPlaywrightChromiumInstalled,
  resolveNpxCommand,
  resolvePlaywrightInvocation,
} from "./playwright-runtime.js";
import { ensurePlaywrightMcpInstalled } from "./playwright-mcp-install.js";
import { buildPlaywrightMcpServerLaunch } from "./browser-mcp-config.js";
import type { BrowserMode } from "./contract-types.js";
import { getSettingsValue } from "../handlers/settings.js";

const execFileAsync = promisify(execFile);

const PREFLIGHT_CACHE_TTL_MS = 15 * 60 * 1000;

export interface PlaywrightPreflightProgress {
  phase: "mcp" | "chromium";
  message: string;
}

export interface PlaywrightPreflightResult {
  ok: boolean;
  message: string;
  error?: string;
  remediated?: boolean;
}

export interface PlaywrightSetupProbe {
  npx: { ready: boolean; path?: string; error?: string };
  playwrightCli: { ready: boolean; version?: string; bundled: boolean; error?: string };
  playwrightMcp: { ready: boolean; version?: string; error?: string };
  chromium: { ready: boolean };
}

let preflightCacheAt: number | null = null;
let preflightCacheMode: BrowserMode | null = null;
const inflightRunPreflight = new Map<
  BrowserMode,
  Promise<PlaywrightPreflightResult>
>();

function cacheFresh(browserMode: BrowserMode): boolean {
  return (
    typeof preflightCacheAt === "number" &&
    preflightCacheMode === browserMode &&
    Date.now() - preflightCacheAt < PREFLIGHT_CACHE_TTL_MS
  );
}

function markCacheOk(browserMode: BrowserMode): void {
  preflightCacheAt = Date.now();
  preflightCacheMode = browserMode;
}

function findBundledPlaywrightCli(): string | null {
  const candidates = [
    path.join(process.cwd(), "node_modules", "playwright", "cli.js"),
    path.join(app.getAppPath(), "node_modules", "playwright", "cli.js"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export interface McpHandshakeProbeResult {
  ready: boolean;
  serverName?: string;
  serverVersion?: string;
  error?: string;
}

const MCP_HANDSHAKE_TIMEOUT_MS = 20_000;

interface McpHandshakeProbeOptions {
  browserMode?: BrowserMode;
  verifyBrowserConnection?: boolean;
  timeoutMs?: number;
}

/**
 * Pulls a short, human-readable line out of a crashed process's stderr —
 * Node's uncaught-exception dumps lead with a noisy `file:///…` location and
 * a source snippet before the actual `Error: message` line, so a raw dump is
 * unreadable in a one-line UI detail.
 */
function summarizeStderr(stderr: string): string | null {
  const lines = stderr
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const errorLine = lines.find(
    (line) => /error:/i.test(line) && !line.startsWith("at ") && !line.startsWith("file://"),
  );
  const picked = errorLine ?? lines.find((line) => !line.startsWith("file://") && !line.startsWith("at "));
  return picked ? picked.slice(0, 200) : null;
}

/**
 * Spawns the exact Playwright MCP command/args a real run would use
 * (`buildPlaywrightMcpServerLaunch`) and performs a live JSON-RPC `initialize`
 * handshake over stdio. This is the only way to know an agent can actually
 * connect — checking that the npm package is downloadable (or that a config
 * file mentions it) says nothing about whether the process starts and speaks
 * the MCP protocol.
 */
export async function probePlaywrightMcpHandshake(
  options: McpHandshakeProbeOptions = {},
): Promise<McpHandshakeProbeResult> {
  const launch = await buildPlaywrightMcpServerLaunch(undefined, {
    browserMode: options.browserMode,
  });

  return new Promise((resolve) => {
    const child = spawn(launch.command, launch.args, {
      env: { ...process.env, ...launch.env, ...launch.secretEnv },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let settled = false;
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let initializedServerName: string | undefined;
    let initializedServerVersion: string | undefined;

    const finish = (result: McpHandshakeProbeResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdout?.removeAllListeners("data");
      child.stderr?.removeAllListeners("data");
      child.removeAllListeners("error");
      child.removeAllListeners("exit");
      child.kill("SIGKILL");
      resolve(result);
    };

    const timeoutMs = options.timeoutMs ?? MCP_HANDSHAKE_TIMEOUT_MS;
    const timer = setTimeout(() => {
      finish({
        ready: false,
        error: `Playwright MCP did not respond within ${timeoutMs / 1000}s.${
          summarizeStderr(stderrBuffer) ? ` ${summarizeStderr(stderrBuffer)}` : ""
        }`,
      });
    }, timeoutMs);

    child.on("error", (err) => {
      finish({ ready: false, error: err.message });
    });

    child.on("exit", (code) => {
      const summary = summarizeStderr(stderrBuffer);
      finish({
        ready: false,
        error: summary ?? `Playwright MCP exited early (code ${code}).`,
      });
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderrBuffer += chunk.toString();
    });

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();
      let newlineIndex: number;
      while ((newlineIndex = stdoutBuffer.indexOf("\n")) !== -1) {
        const line = stdoutBuffer.slice(0, newlineIndex).trim();
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        if (!line) continue;

        let message: {
          id?: number;
          result?: {
            serverInfo?: { name?: string; version?: string };
            tools?: Array<{ name?: string; inputSchema?: { type?: string } }>;
            isError?: boolean;
            content?: Array<{ type?: string; text?: string }>;
          };
          error?: { message?: string };
        };
        try {
          message = JSON.parse(line);
        } catch {
          continue; // Not a JSON-RPC line (e.g. a stray log line) — keep reading.
        }

        if (message.id === 1) {
          if (message.error) {
            finish({
              ready: false,
              error: message.error.message ?? "Playwright MCP returned an error during initialize.",
            });
            return;
          }

          initializedServerName = message.result?.serverInfo?.name;
          initializedServerVersion = message.result?.serverInfo?.version;
          child.stdin?.write(
            JSON.stringify({
              jsonrpc: "2.0",
              method: "notifications/initialized",
            }) + "\n",
          );
          child.stdin?.write(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 2,
              method: "tools/list",
              params: {},
            }) + "\n",
          );
          continue;
        }

        if (message.id === 3) {
          if (message.error || message.result?.isError) {
            const toolError = message.result?.content
              ?.find((item) => item.type === "text")
              ?.text?.trim();
            finish({
              ready: false,
              error:
                message.error?.message ??
                toolError ??
                "Playwright MCP could not connect to Chrome.",
            });
            return;
          }
          finish({
            ready: true,
            serverName: initializedServerName,
            serverVersion: initializedServerVersion,
          });
          return;
        }

        if (message.id !== 2) continue;
        if (message.error) {
          finish({
            ready: false,
            error: message.error.message ?? "Playwright MCP could not list its browser tools.",
          });
          return;
        }

        const tools = message.result?.tools;
        if (!tools?.length) {
          finish({ ready: false, error: "Playwright MCP returned no browser tools." });
          return;
        }
        const invalidTool = tools.find((tool) => tool.inputSchema?.type !== "object");
        if (invalidTool) {
          finish({
            ready: false,
            error:
              `Playwright MCP tool "${invalidTool.name ?? "unknown"}" has an incompatible input schema. ` +
              "Reinstall or update Playwright MCP.",
          });
          return;
        }

        if (!options.verifyBrowserConnection) {
          finish({
            ready: true,
            serverName: initializedServerName,
            serverVersion: initializedServerVersion,
          });
          return;
        }

        const tabTool = tools.find((tool) => tool.name === "browser_tabs");
        const snapshotTool = tools.find(
          (tool) => tool.name === "browser_snapshot",
        );
        const connectionTool = tabTool ?? snapshotTool;
        if (!connectionTool?.name) {
          finish({
            ready: false,
            error:
              "This Playwright MCP version cannot verify an existing Chrome connection.",
          });
          return;
        }
        child.stdin?.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 3,
            method: "tools/call",
            params: {
              name: connectionTool.name,
              arguments: tabTool ? { action: "list" } : {},
            },
          }) + "\n",
        );
      }
    });

    const request = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "story-studio-setup-probe", version: "1.0.0" },
      },
    };
    child.stdin?.write(JSON.stringify(request) + "\n");
  });
}

export function probeExistingChromeConnection(): Promise<McpHandshakeProbeResult> {
  return probePlaywrightMcpHandshake({
    browserMode: "existing-chrome",
    verifyBrowserConnection: true,
    timeoutMs: 45_000,
  });
}

/** Read-only probes for the Settings → Setup panel (no auto-install). */
export async function probePlaywrightSetup(): Promise<PlaywrightSetupProbe> {
  let npxProbe: PlaywrightSetupProbe["npx"] = { ready: false };
  try {
    const npxPath = await resolveNpxCommand();
    const resolved = path.isAbsolute(npxPath) && existsSync(npxPath);
    npxProbe = {
      ready: resolved,
      path: npxPath,
      error: resolved ? undefined : `Could not resolve npx (got ${npxPath})`,
    };
  } catch (err) {
    npxProbe.error = err instanceof Error ? err.message : String(err);
  }

  let playwrightCli: PlaywrightSetupProbe["playwrightCli"] = {
    ready: false,
    bundled: Boolean(findBundledPlaywrightCli()),
  };
  try {
    const playwright = resolvePlaywrightInvocation();
    const { stdout } = await execFileAsync(
      playwright.command,
      [...playwright.prefixArgs, "--version"],
      {
        env: buildPlaywrightEnv({ electronAsNode: playwright.useElectronAsNode }),
        timeout: 45_000,
        maxBuffer: 1024 * 64,
      },
    );
    const versionMatch = stdout.match(/\d+\.\d+\.\d+/);
    playwrightCli = {
      ready: /\bVersion\b/i.test(stdout) || Boolean(versionMatch),
      version: versionMatch?.[0],
      bundled: Boolean(findBundledPlaywrightCli()),
    };
  } catch (err) {
    playwrightCli.error = err instanceof Error ? err.message : String(err);
  }

  let playwrightMcp: PlaywrightSetupProbe["playwrightMcp"] = { ready: false };
  try {
    const handshake = await probePlaywrightMcpHandshake({
      browserMode: "private",
    });
    playwrightMcp = {
      ready: handshake.ready,
      version: handshake.serverVersion,
      error: handshake.ready ? undefined : handshake.error,
    };
  } catch (err) {
    playwrightMcp.error = err instanceof Error ? err.message : String(err);
  }

  return {
    npx: npxProbe,
    playwrightCli,
    playwrightMcp,
    chromium: { ready: await isPlaywrightChromiumInstalled() },
  };
}

async function warmPlaywrightMcpPackage(): Promise<{ ok: boolean; error?: string }> {
  // Prefer a one-time local install so story runs launch the MCP by absolute
  // path (no per-run npx registry round-trip). Fall back to warming the npx
  // cache if the local install could not be created.
  const installed = await ensurePlaywrightMcpInstalled();
  if (installed) return { ok: true };

  try {
    const npxPath = await resolveNpxCommand();
    await execFileAsync(
      npxPath,
      ["-y", playwrightMcpPackageSpec(), "--version"],
      {
        env: buildPlaywrightEnv(),
        timeout: 2 * 60_000,
        maxBuffer: 10 * 1024 * 1024,
      },
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function verifyPlaywrightCli(): Promise<{ ok: boolean; error?: string }> {
  try {
    const playwright = resolvePlaywrightInvocation();
    const { stdout } = await execFileAsync(
      playwright.command,
      [...playwright.prefixArgs, "--version"],
      {
        env: buildPlaywrightEnv({ electronAsNode: playwright.useElectronAsNode }),
        timeout: 45_000,
        maxBuffer: 1024 * 64,
      },
    );
    const ready = /\bVersion\b/i.test(stdout) || /\d+\.\d+\.\d+/.test(stdout);
    return ready ? { ok: true } : { ok: false, error: "Playwright CLI returned an unexpected version response." };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function ensureHeadlessChromium(
  onProgress?: (progress: PlaywrightPreflightProgress) => void,
): Promise<{ ok: boolean; error?: string; remediated: boolean }> {
  let remediated = false;

  if (!(await isPlaywrightChromiumInstalled())) {
    onProgress?.({ phase: "chromium", message: "Installing Chromium…" });
    const installRes = await installPlaywrightChromium();
    remediated = true;
    if (!installRes.ok) {
      return { ok: false, error: installRes.error ?? "Failed to install Chromium.", remediated };
    }
    if (!(await isPlaywrightChromiumInstalled())) {
      return {
        ok: false,
        error: "Chromium installation finished, but no runnable browser was found.",
        remediated,
      };
    }
  }

  return { ok: true, remediated };
}

async function quickVerify(
  browserMode: BrowserMode,
): Promise<PlaywrightPreflightResult> {
  if (browserMode === "existing-chrome") {
    return { ok: true, message: "Playwright MCP ready for Chrome." };
  }
  if (!(await isPlaywrightChromiumInstalled())) {
    return {
      ok: false,
      message: "Chromium is not installed.",
      error: "Chromium not found",
    };
  }

  return { ok: true, message: "Browser ready." };
}

async function runPreflight(options: {
  onProgress?: (progress: PlaywrightPreflightProgress) => void;
  browserMode?: BrowserMode;
}): Promise<PlaywrightPreflightResult> {
  const { onProgress } = options;
  const browserMode =
    options.browserMode ?? getSettingsValue().browserMode;
  let remediated = false;

  if (cacheFresh(browserMode)) {
    const cached = await quickVerify(browserMode);
    if (cached.ok) {
      console.log("[playwright] using cached preflight");
      return cached;
    }
    console.log("[playwright] cache stale — re-running preflight");
  }

  onProgress?.({ phase: "mcp", message: "Preparing Playwright…" });
  const cli = await verifyPlaywrightCli();
  if (!cli.ok) {
    return {
      ok: false,
      message: "Playwright CLI is unavailable. Open Settings → Setup to fix.",
      error: cli.error,
    };
  }

  onProgress?.({ phase: "mcp", message: "Downloading Playwright MCP…" });
  const warm = await warmPlaywrightMcpPackage();
  if (!warm.ok) {
    return {
      ok: false,
      message: "Failed to download Playwright MCP. Open Settings → Setup to fix.",
      error: warm.error,
    };
  }

  if (browserMode === "private") {
    const chromium = await ensureHeadlessChromium(onProgress);
    remediated = remediated || chromium.remediated;
    if (!chromium.ok) {
      return {
        ok: false,
        message:
          "Could not prepare headless Chromium. Open Settings → Setup to install.",
        error: chromium.error,
        remediated,
      };
    }
  }

  markCacheOk(browserMode);
  return {
    ok: true,
    message:
      browserMode === "existing-chrome"
        ? "Playwright MCP ready for Chrome."
        : remediated
          ? "Browser environment repaired and ready."
          : "Browser ready.",
    remediated,
  };
}

/**
 * Prepare Playwright for a story run or recording — warms MCP and auto-installs
 * Chromium when missing. Does not run flaky MCP server smoke tests.
 */
export async function ensurePlaywrightReady(options?: {
  onProgress?: (progress: PlaywrightPreflightProgress) => void;
  browserMode?: BrowserMode;
}): Promise<PlaywrightPreflightResult> {
  const browserMode =
    options?.browserMode ?? getSettingsValue().browserMode;
  const inflight = inflightRunPreflight.get(browserMode);
  if (inflight) {
    console.log("[playwright] joining in-flight run preflight");
    return inflight;
  }

  const promise = runPreflight({ ...options, browserMode }).finally(() => {
    inflightRunPreflight.delete(browserMode);
  });

  inflightRunPreflight.set(browserMode, promise);
  return promise;
}

/** Fire-and-forget warmup on app launch — never blocks story runs. */
export function prewarmPlaywrightInBackground(): void {
  void runPreflight({})
    .then((res) => {
      if (res.ok) {
        console.log("[playwright] background prewarm ok");
      } else {
        console.warn("[playwright] background prewarm failed", res.error ?? res.message);
      }
    })
    .catch((err) => {
      console.warn("[playwright] background prewarm error", err);
    });
}
