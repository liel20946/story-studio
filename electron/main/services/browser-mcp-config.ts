import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { playwrightMcpPackageSpec } from "./setup-versions.js";
import { buildPlaywrightEnv, resolveNpxCommand } from "./playwright-runtime.js";
import {
  resolveInstalledMcpCli,
  resolveNodeCommand,
} from "./playwright-mcp-install.js";
import type { BrowserMode } from "./contract-types.js";
import { getSettingsValue } from "../handlers/settings.js";
import { readBrowserExtensionToken } from "./browser-extension-auth.js";

/** MCP server flags only (no launcher/package spec) — shared by npx + local-install launches. */
export function mcpServerFlags(
  outputDir?: string,
  browserMode: BrowserMode = getSettingsValue().browserMode,
): string[] {
  // Playwright MCP expects comma-separated "width,height"; an "x"-separated
  // value throws "Invalid viewport size format" at startup.
  const flags =
    browserMode === "existing-chrome"
      ? [
          "--extension",
          "--timeout-action",
          "10000",
          "--timeout-navigation",
          "30000",
        ]
      : ["--headless", "--isolated", "--viewport-size=1920,1080"];
  if (outputDir) flags.push("--output-dir", outputDir);
  return flags;
}

export function playwrightMcpArgs(
  outputDir?: string,
  browserMode?: BrowserMode,
): string[] {
  const pkg = playwrightMcpPackageSpec();
  // Pinned package + flag order for the npx `-y` launch (fallback path).
  return ["-y", pkg, ...mcpServerFlags(outputDir, browserMode)];
}

export interface PlaywrightMcpServerLaunch {
  command: string;
  args: string[];
  env: Record<string, string>;
  /** Passed only to the parent process; never serialized into persisted MCP config files. */
  secretEnv: Record<string, string>;
}

export interface PlaywrightMcpLaunchOptions {
  browserMode?: BrowserMode;
}

export async function playwrightMcpSecretEnv(
  browserMode: BrowserMode = getSettingsValue().browserMode,
): Promise<Record<string, string>> {
  if (browserMode !== "existing-chrome") return {};
  const token = await readBrowserExtensionToken();
  return token ? { PLAYWRIGHT_MCP_EXTENSION_TOKEN: token } : {};
}

/**
 * Full MCP launch spec for agent child processes.
 *
 * Prefers the app-managed local install (`node <cli> …`) so the MCP starts
 * without an `npx -y` registry round-trip on every run. Falls back to the
 * original `npx -y @playwright/mcp@<pinned>` launch when the local install or a
 * resolvable node binary is unavailable, so runs never break.
 */
export async function buildPlaywrightMcpServerLaunch(
  outputDir?: string,
  options: PlaywrightMcpLaunchOptions = {},
): Promise<PlaywrightMcpServerLaunch> {
  const browserMode = options.browserMode ?? getSettingsValue().browserMode;
  const baseEnv = buildPlaywrightEnv();
  const env: Record<string, string> = {
    PATH: baseEnv.PATH ?? "",
    HOME: baseEnv.HOME ?? os.homedir(),
  };
  const secretEnv = await playwrightMcpSecretEnv(browserMode);

  const cli = await resolveInstalledMcpCli();
  const node = cli ? await resolveNodeCommand() : null;
  if (cli && node) {
    return {
      command: node,
      args: [cli, ...mcpServerFlags(outputDir, browserMode)],
      env,
      secretEnv,
    };
  }

  const command = await resolveNpxCommand();
  return {
    command,
    args: playwrightMcpArgs(outputDir, browserMode),
    env,
    secretEnv,
  };
}

/**
 * Codex `-c` overrides that register the Playwright MCP INLINE (command + args).
 *
 * Story runs pass `--ignore-user-config` to stay isolated from the user's global
 * ~/.codex/config.toml (notably `[features] multi_agent = true`, which would fan a
 * single story out to parallel sub-agents). But that flag also makes codex ignore
 * the project `.codex/config.toml`, so the MCP would not register and no browser
 * tool would be available. Injecting the server here via `-c` gives codex the MCP
 * regardless of user/project config. Reuses the fast local node+cli launch when
 * available, falling back to npx.
 */
export async function buildCodexPlaywrightMcpConfigArgs(
  outputDir?: string,
): Promise<string[]> {
  const launch = await buildPlaywrightMcpServerLaunch(outputDir);
  const args = [
    "-c",
    "features.js_repl=false",
    "-c",
    "mcp_servers.playwright.enabled=true",
    "-c",
    `mcp_servers.playwright.command=${JSON.stringify(launch.command)}`,
    "-c",
    `mcp_servers.playwright.args=${JSON.stringify(launch.args)}`,
    "-c",
    "mcp_servers.playwright.startup_timeout_sec=120",
    "-c",
    "mcp_servers.playwright.tool_timeout_sec=45",
  ];
  for (const [key, value] of Object.entries(launch.env)) {
    args.push(
      "-c",
      `mcp_servers.playwright.env.${key}=${JSON.stringify(value)}`,
    );
  }
  return args;
}

export async function buildClaudeMcpConfigJson(outputDir?: string): Promise<string> {
  const launch = await buildPlaywrightMcpServerLaunch(outputDir);
  return JSON.stringify({
    mcpServers: {
      playwright: {
        type: "stdio",
        command: launch.command,
        args: launch.args,
        env: launch.env,
      },
    },
  });
}

export async function writeClaudeMcpConfigFile(
  configDir: string,
  outputDir?: string,
): Promise<string> {
  const mcpPath = path.join(configDir, "story-studio-mcp.json");
  const contents = await buildClaudeMcpConfigJson(outputDir);
  await fs.writeFile(mcpPath, contents, "utf-8");
  console.log("[mcp] wrote Claude MCP config", { mcpPath, command: JSON.parse(contents).mcpServers.playwright.command });
  return mcpPath;
}

export async function projectCodexConfigToml(): Promise<string> {
  // Claude / absolute-npx paths still use the resolved launch spec.
  const launch = await buildPlaywrightMcpServerLaunch();
  const envLines = Object.entries(launch.env)
    .map(([key, value]) => `${key} = ${JSON.stringify(value)}`)
    .join("\n");
  return `[mcp_servers.playwright]
command = ${JSON.stringify(launch.command)}
args = ${JSON.stringify(launch.args)}
enabled = true
startup_timeout_sec = 120
tool_timeout_sec = 45

[mcp_servers.playwright.env]
${envLines}

[features]
js_repl = false
`;
}
