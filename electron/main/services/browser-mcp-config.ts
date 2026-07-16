import { existsSync, readdirSync } from "fs";
import * as os from "os";
import * as path from "path";
import type { BrowserMcp } from "./contract-types.js";

/** Effective browser backend after Computer Use override. */
export type EffectiveBrowserTool = BrowserMcp | "computer-use";

export function resolveEffectiveBrowserTool(options: {
  browserMcp?: BrowserMcp | null;
  computerUse?: boolean;
}): EffectiveBrowserTool {
  if (options.computerUse) return "computer-use";
  return options.browserMcp === "chrome-devtools" ? "chrome-devtools" : "playwright";
}

/** True when the selected browser backend needs Google Chrome installed. */
export function needsGoogleChrome(options: {
  browserMcp?: BrowserMcp | null;
  computerUse?: boolean;
}): boolean {
  return Boolean(options.computerUse) || options.browserMcp === "chrome-devtools";
}

const PLAYWRIGHT_MCP_ARGS = [
  "-y",
  "@playwright/mcp@latest",
  "--headless",
  "--isolated",
  "--viewport-size=1920x1080",
] as const;

export function chromeDevToolsMcpArgs(options?: {
  /** Attach to an existing Chrome debugging endpoint (headed recording). */
  browserUrl?: string;
  /**
   * Connect to the user's already-running Chrome (Chrome 144+ with
   * chrome://inspect/#remote-debugging enabled). Prefer this for recording.
   */
  autoConnect?: boolean;
}): string[] {
  const args = ["-y", "chrome-devtools-mcp@latest"];
  if (options?.browserUrl) {
    args.push(`--browser-url=${options.browserUrl}`);
  } else if (options?.autoConnect) {
    args.push("--autoConnect");
  } else {
    args.push("--headless", "--isolated");
  }
  return args;
}

/** Locate the bundled SkyComputerUseClient MCP helper. */
export function findComputerUseHelper(): {
  command: string;
  cwd: string;
  args: string[];
} | null {
  const home = os.homedir();
  const relativeHelper =
    "Codex Computer Use.app/Contents/SharedSupport/SkyComputerUseClient.app/Contents/MacOS/SkyComputerUseClient";
  const searchRoots: string[] = [];

  const cacheRoot = path.join(home, ".codex/plugins/cache/openai-bundled/computer-use");
  if (existsSync(cacheRoot)) {
    try {
      for (const entry of readdirSync(cacheRoot)) {
        searchRoots.push(path.join(cacheRoot, entry));
      }
    } catch {
      // ignore
    }
  }

  for (const root of [
    "/Applications/Codex.app/Contents/Resources/plugins/openai-bundled/computer-use",
    "/Applications/Codex.app/Contents/Resources/plugins/openai-bundled/plugins/computer-use",
  ]) {
    if (!existsSync(root)) continue;
    searchRoots.push(root);
    try {
      for (const entry of readdirSync(root)) {
        searchRoots.push(path.join(root, entry));
      }
    } catch {
      // ignore
    }
  }

  for (const dir of searchRoots) {
    const command = path.join(dir, relativeHelper);
    if (existsSync(command)) {
      return { command, cwd: dir, args: ["mcp"] };
    }
  }
  return null;
}

function codexHomeDir(): string {
  const fromEnv = process.env.CODEX_HOME?.trim();
  if (fromEnv) return fromEnv;
  return path.join(os.homedir(), ".codex");
}

/** Codex `-c` overrides for the selected browser MCP. */
export function buildCodexMcpConfigArgs(
  browserMcp: BrowserMcp = "playwright",
  options?: { browserUrl?: string; autoConnect?: boolean },
): string[] {
  if (browserMcp === "chrome-devtools") {
    const mcpArgs = chromeDevToolsMcpArgs({
      browserUrl: options?.browserUrl,
      autoConnect: options?.autoConnect,
    });
    return [
      "-c",
      "mcp_servers.chrome-devtools.enabled=true",
      "-c",
      'mcp_servers.chrome-devtools.command="npx"',
      "-c",
      `mcp_servers.chrome-devtools.args=${JSON.stringify(mcpArgs)}`,
      "-c",
      "mcp_servers.chrome-devtools.startup_timeout_sec=60",
      "-c",
      "features.js_repl=false",
    ];
  }
  return [
    "-c",
    "mcp_servers.playwright.enabled=true",
    "-c",
    'mcp_servers.playwright.command="npx"',
    "-c",
    `mcp_servers.playwright.args=${JSON.stringify([...PLAYWRIGHT_MCP_ARGS])}`,
    "-c",
    "mcp_servers.playwright.startup_timeout_sec=60",
    "-c",
    "features.js_repl=false",
  ];
}

/**
 * Codex `-c` overrides for Computer Use runs.
 * Explicitly wires the SkyComputerUseClient MCP helper when found so CLI
 * sessions (including Story Studio) can load Computer Use without relying
 * solely on plugin discovery.
 */
export function buildCodexComputerUseConfigArgs(): string[] {
  const args = ["-c", "features.js_repl=false"];
  const helper = findComputerUseHelper();
  const home = codexHomeDir();
  if (!helper) {
    console.warn(
      "[computer-use] SkyComputerUseClient not found under ~/.codex/plugins or Codex.app — relying on user Codex plugin config",
    );
    return args;
  }

  console.log("[computer-use] wiring MCP helper", {
    command: helper.command,
    cwd: helper.cwd,
  });

  return [
    ...args,
    "-c",
    "mcp_servers.computer-use.enabled=true",
    "-c",
    `mcp_servers.computer-use.command=${JSON.stringify(helper.command)}`,
    "-c",
    `mcp_servers.computer-use.args=${JSON.stringify(helper.args)}`,
    "-c",
    `mcp_servers.computer-use.cwd=${JSON.stringify(helper.cwd)}`,
    "-c",
    `mcp_servers.computer-use.env.CODEX_HOME=${JSON.stringify(home)}`,
    "-c",
    `mcp_servers.computer-use.env.CODEX_SQLITE_HOME=${JSON.stringify(path.join(home, "sqlite"))}`,
    "-c",
    "mcp_servers.computer-use.startup_timeout_sec=60",
  ];
}

/** Claude `--mcp-config` JSON for the selected browser MCP. */
export function buildClaudeMcpConfigJson(
  browserMcp: BrowserMcp = "playwright",
  options?: { browserUrl?: string; autoConnect?: boolean },
): string {
  if (browserMcp === "chrome-devtools") {
    return JSON.stringify({
      mcpServers: {
        "chrome-devtools": {
          command: "npx",
          args: chromeDevToolsMcpArgs({
            browserUrl: options?.browserUrl,
            autoConnect: options?.autoConnect,
          }),
        },
      },
    });
  }
  return JSON.stringify({
    mcpServers: {
      playwright: {
        command: "npx",
        args: [...PLAYWRIGHT_MCP_ARGS],
      },
    },
  });
}

export function projectCodexConfigToml(
  browserMcp: BrowserMcp = "playwright",
  options?: { browserUrl?: string; autoConnect?: boolean },
): string {
  if (browserMcp === "chrome-devtools") {
    return `[mcp_servers.chrome-devtools]
command = "npx"
args = ${JSON.stringify(
      chromeDevToolsMcpArgs({
        browserUrl: options?.browserUrl,
        autoConnect: options?.autoConnect,
      }),
    )}
enabled = true
startup_timeout_sec = 60

[features]
js_repl = false
`;
  }
  return `[mcp_servers.playwright]
command = "npx"
args = ${JSON.stringify([...PLAYWRIGHT_MCP_ARGS])}
enabled = true
startup_timeout_sec = 60

[features]
js_repl = false
`;
}

export function projectCodexComputerUseConfigToml(): string {
  const helper = findComputerUseHelper();
  const home = codexHomeDir();
  if (!helper) {
    return `[features]
js_repl = false
`;
  }
  return `[mcp_servers.computer-use]
command = ${JSON.stringify(helper.command)}
args = ${JSON.stringify(helper.args)}
cwd = ${JSON.stringify(helper.cwd)}
enabled = true
startup_timeout_sec = 60

[mcp_servers.computer-use.env]
CODEX_HOME = ${JSON.stringify(home)}
CODEX_SQLITE_HOME = ${JSON.stringify(path.join(home, "sqlite"))}

[features]
js_repl = false
`;
}

/** @deprecated Prefer projectCodexComputerUseConfigToml() */
export const PROJECT_CODEX_COMPUTER_USE_CONFIG = `[features]
js_repl = false
`;
