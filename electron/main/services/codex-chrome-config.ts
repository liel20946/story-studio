import { existsSync } from "fs";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

/** Real user Codex home (auth + plugin cache). */
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

/** Minimal TOML table extractor for `key = value` lines inside `[table]`. */
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

export async function resolveCodexNodeReplLaunch(
  realCodexHome: string = getCodexHome(),
): Promise<CodexNodeReplLaunch> {
  const configPath = path.join(realCodexHome, "config.toml");
  let toml = "";
  try {
    toml = await fs.readFile(configPath, "utf-8");
  } catch {
    // fall through
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
          if (Array.isArray(parsed)) args = parsed.map(String);
        } catch {
          args = [];
        }
      }
      const env: Record<string, string> = { ...envTable };
      // Keep chrome available; include iab so backends match known-good Desktop/CLI configs.
      if (!env.BROWSER_USE_AVAILABLE_BACKENDS?.includes("chrome")) {
        env.BROWSER_USE_AVAILABLE_BACKENDS = "chrome,iab";
      }
      if (!env.NODE_REPL_TRUSTED_CODE_PATHS) {
        env.NODE_REPL_TRUSTED_CODE_PATHS = realCodexHome;
      }
      if (!env.SKY_CUA_NATIVE_PIPE) {
        env.SKY_CUA_NATIVE_PIPE = "1";
      }
      return { command, args, env, source: "user-config" };
    }
  }

  const command = firstExisting(candidateNodeReplBinaries());
  if (!command) {
    throw new Error(
      "Codex node_repl not found. Open the Codex app once so Chrome + node_repl are installed, then retry.",
    );
  }
  const nodePath = firstExisting(candidateNodeBinaries());
  const env: Record<string, string> = {
    BROWSER_USE_AVAILABLE_BACKENDS: "chrome,iab",
    NODE_REPL_TRUSTED_CODE_PATHS: realCodexHome,
    SKY_CUA_NATIVE_PIPE: "1",
  };
  if (nodePath) env.NODE_REPL_NODE_PATH = nodePath;
  return { command, args: [], env, source: "codex-app" };
}

async function symlinkInto(isolatedHome: string, realHome: string, name: string): Promise<void> {
  const target = path.join(realHome, name);
  if (!existsSync(target)) return;
  const link = path.join(isolatedHome, name);
  try {
    await fs.rm(link, { recursive: true, force: true });
  } catch {
    // ignore
  }
  await fs.symlink(target, link);
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

/**
 * Build an isolated CODEX_HOME for Chrome runs:
 * - Loads ONLY chrome plugin + node_repl (no user global MCPs → fast start)
 * - Symlinks auth + plugin cache from the real ~/.codex
 *
 * Why not `--ignore-user-config` + `-c plugins…`?
 * Codex loads plugins only from the User config layer. CLI `-c` overrides do
 * not install/enable plugins, so @Chrome never mounts under ignore-user-config.
 */
export async function prepareCodexChromeHome(isolatedHome: string): Promise<{
  codexHome: string;
  nodeRepl: CodexNodeReplLaunch;
}> {
  const realHome = getCodexHome();
  const nodeRepl = await resolveCodexNodeReplLaunch(realHome);

  await fs.mkdir(isolatedHome, { recursive: true });

  // Auth + installed plugins/skills must come from the real Codex home.
  for (const name of [
    "auth.json",
    "auth",
    "plugins",
    ".tmp",
    "vendor_imports",
    "version.json",
  ]) {
    await symlinkInto(isolatedHome, realHome, name);
  }

  const envLines = Object.entries(nodeRepl.env)
    .map(([key, value]) => `${key} = ${tomlString(value)}`)
    .join("\n");

  const configToml = `# Story Studio isolated Codex home — Chrome only (no user MCP servers).
[features]
multi_agent = false
browser_use_external = true

[plugins."chrome@openai-bundled"]
enabled = true

[mcp_servers.node_repl]
enabled = true
command = ${tomlString(nodeRepl.command)}
args = ${JSON.stringify(nodeRepl.args)}
startup_timeout_sec = 120
enabled_tools = ["js", "js_add_node_module_dir", "js_reset"]

[mcp_servers.node_repl.env]
${envLines}
`;

  await fs.writeFile(path.join(isolatedHome, "config.toml"), configToml, "utf-8");
  console.log("[codex:chrome] prepared isolated CODEX_HOME", {
    isolatedHome,
    realHome,
    nodeRepl: nodeRepl.command,
    source: nodeRepl.source,
  });

  return { codexHome: isolatedHome, nodeRepl };
}

/** Extra `-c` pins for Chrome mode (plugins live in isolated config.toml). */
export function buildCodexChromeConfigArgs(): string[] {
  return [
    "-c",
    "features.multi_agent=false",
    "-c",
    "features.browser_use_external=true",
  ];
}
