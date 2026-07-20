import { existsSync } from "fs";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

/** Codex home — plugins/cache + config.toml live here even with --ignore-user-config. */
export function getCodexHome(): string {
  const fromEnv = process.env.CODEX_HOME?.trim();
  if (fromEnv) return fromEnv;
  return path.join(os.homedir(), ".codex");
}

function unquoteTomlValue(raw: string): string {
  const value = raw.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    const inner = value.slice(1, -1);
    if (value.startsWith('"')) {
      try {
        return JSON.parse(value) as string;
      } catch {
        return inner.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
      }
    }
    return inner;
  }
  return value;
}

/**
 * Minimal TOML table extractor for Codex config slices we care about.
 * Enough for `key = "value"` / bool / number / [] lines inside a `[table]`.
 */
export function extractTomlTable(
  toml: string,
  header: string,
): Record<string, string> {
  const needle = `[${header}]`;
  const start = toml.indexOf(needle);
  if (start < 0) return {};
  const after = toml.slice(start + needle.length);
  const nextHeader = after.search(/\n\[/);
  const body = nextHeader >= 0 ? after.slice(0, nextHeader) : after;
  const out: Record<string, string> = {};
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    out[key] = unquoteTomlValue(line.slice(eq + 1));
  }
  return out;
}

function candidateNodeReplBinaries(): string[] {
  const home = os.homedir();
  const candidates: string[] = [];
  if (process.platform === "darwin") {
    candidates.push(
      "/Applications/Codex.app/Contents/Resources/node_repl",
      path.join(home, "Applications/Codex.app/Contents/Resources/node_repl"),
    );
  }
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local");
    candidates.push(
      path.join(local, "OpenAI/Codex/node_repl.exe"),
      path.join(local, "Programs/Codex/node_repl.exe"),
    );
  }
  return candidates;
}

function candidateNodeBinaries(): string[] {
  const home = os.homedir();
  if (process.platform === "darwin") {
    return [
      "/Applications/Codex.app/Contents/Resources/node",
      path.join(home, "Applications/Codex.app/Contents/Resources/node"),
    ];
  }
  return [];
}

function firstExisting(paths: string[]): string | undefined {
  return paths.find((p) => existsSync(p));
}

export interface CodexNodeReplLaunch {
  command: string;
  args: string[];
  env: Record<string, string>;
  source: "user-config" | "codex-app" | "fallback";
}

/**
 * Resolve the Codex `node_repl` MCP launch the same way Playwright resolves its
 * MCP: prefer the user's configured command/env from ~/.codex/config.toml, then
 * fall back to the Codex.app bundled binary. Callers inject this via `-c` while
 * keeping `--ignore-user-config` so other global MCPs never load.
 */
export async function resolveCodexNodeReplLaunch(): Promise<CodexNodeReplLaunch> {
  const codexHome = getCodexHome();
  const configPath = path.join(codexHome, "config.toml");
  let toml = "";
  try {
    toml = await fs.readFile(configPath, "utf-8");
  } catch {
    // no user config — fall through to bundled paths
  }

  if (toml) {
    const table = extractTomlTable(toml, "mcp_servers.node_repl");
    const envTable = extractTomlTable(toml, "mcp_servers.node_repl.env");
    const command = table.command?.trim();
    if (command && existsSync(command)) {
      let args: string[] = [];
      if (table.args?.trim()) {
        try {
          const parsed = JSON.parse(table.args) as unknown;
          if (Array.isArray(parsed)) {
            args = parsed.map(String);
          }
        } catch {
          args = [];
        }
      }
      const env: Record<string, string> = { ...envTable };
      if (!env.NODE_REPL_TRUSTED_CODE_PATHS) {
        env.NODE_REPL_TRUSTED_CODE_PATHS = codexHome;
      }
      // Chrome-only for Story Studio — do not pull in the in-app browser backend.
      env.BROWSER_USE_AVAILABLE_BACKENDS = "chrome";
      return { command, args, env, source: "user-config" };
    }
  }

  const command = firstExisting(candidateNodeReplBinaries());
  if (!command) {
    throw new Error(
      "Codex node_repl not found. Install/open the Codex app once so Chrome plugin + node_repl are configured, then retry.",
    );
  }
  const nodePath = firstExisting(candidateNodeBinaries());
  const env: Record<string, string> = {
    BROWSER_USE_AVAILABLE_BACKENDS: "chrome",
    NODE_REPL_TRUSTED_CODE_PATHS: codexHome,
  };
  if (nodePath) env.NODE_REPL_NODE_PATH = nodePath;
  return { command, args: [], env, source: "codex-app" };
}

/**
 * Codex `-c` overrides for Chrome-extension mode — mirrors Playwright MCP
 * injection: keep `--ignore-user-config`, register only node_repl + Chrome
 * plugin flags so global MCPs never load / delay startup.
 */
export async function buildCodexChromeConfigArgs(): Promise<string[]> {
  const launch = await resolveCodexNodeReplLaunch();
  console.log("[codex:chrome] node_repl launch", {
    source: launch.source,
    command: launch.command,
  });

  const args = [
    "-c",
    "features.multi_agent=false",
    "-c",
    "features.browser_use_external=true",
    // node_repl JS tool is required for @Chrome bootstrap
    "-c",
    "features.js_repl=true",
    "-c",
    'plugins."chrome@openai-bundled".enabled=true',
    "-c",
    "mcp_servers.node_repl.enabled=true",
    "-c",
    `mcp_servers.node_repl.command=${JSON.stringify(launch.command)}`,
    "-c",
    `mcp_servers.node_repl.args=${JSON.stringify(launch.args)}`,
    "-c",
    "mcp_servers.node_repl.startup_timeout_sec=120",
  ];
  for (const [key, value] of Object.entries(launch.env)) {
    args.push(
      "-c",
      `mcp_servers.node_repl.env.${key}=${JSON.stringify(value)}`,
    );
  }
  return args;
}
