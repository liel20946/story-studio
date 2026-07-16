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
}): string[] {
  const args = ["-y", "chrome-devtools-mcp@latest"];
  if (options?.browserUrl) {
    args.push(`--browser-url=${options.browserUrl}`);
  } else {
    args.push("--headless", "--isolated");
  }
  return args;
}

/** Codex `-c` overrides for the selected browser MCP. */
export function buildCodexMcpConfigArgs(
  browserMcp: BrowserMcp = "playwright",
  options?: { browserUrl?: string },
): string[] {
  if (browserMcp === "chrome-devtools") {
    const mcpArgs = chromeDevToolsMcpArgs({ browserUrl: options?.browserUrl });
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

/** Codex `-c` overrides for Computer Use runs — no browser MCP. */
export function buildCodexComputerUseConfigArgs(): string[] {
  return ["-c", "features.js_repl=false"];
}

/** Claude `--mcp-config` JSON for the selected browser MCP. */
export function buildClaudeMcpConfigJson(
  browserMcp: BrowserMcp = "playwright",
  options?: { browserUrl?: string },
): string {
  if (browserMcp === "chrome-devtools") {
    return JSON.stringify({
      mcpServers: {
        "chrome-devtools": {
          command: "npx",
          args: chromeDevToolsMcpArgs({ browserUrl: options?.browserUrl }),
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
  options?: { browserUrl?: string },
): string {
  if (browserMcp === "chrome-devtools") {
    return `[mcp_servers.chrome-devtools]
command = "npx"
args = ${JSON.stringify(chromeDevToolsMcpArgs({ browserUrl: options?.browserUrl }))}
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

export const PROJECT_CODEX_COMPUTER_USE_CONFIG = `[features]
js_repl = false
`;
