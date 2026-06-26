import * as fs from "fs/promises";
import * as path from "path";

/** Codex `-c` overrides that fully define the headless Playwright MCP server for runs. */
export function buildCodexMcpConfigArgs(): string[] {
  // Do NOT set mcp_servers.node_repl here — a partial MCP table without
  // command/url causes "invalid transport" when combined with --ignore-user-config.
  return [
    "-c",
    "mcp_servers.playwright.enabled=true",
    "-c",
    'mcp_servers.playwright.command="npx"',
    "-c",
    'mcp_servers.playwright.args=["-y","@playwright/mcp@latest","--headless","--isolated"]',
    "-c",
    "mcp_servers.playwright.startup_timeout_sec=60",
    "-c",
    "features.js_repl=false",
  ];
}

const PROJECT_CODEX_CONFIG = `[mcp_servers.playwright]
command = "npx"
args = ["-y", "@playwright/mcp@latest", "--headless", "--isolated"]
enabled = true
startup_timeout_sec = 60

[features]
js_repl = false
`;

/** Codex `-c` overrides for recording conversion — text only, no MCP. */
export function buildCodexConversionConfigArgs(): string[] {
  // Do NOT set mcp_servers.* here — partial MCP tables without command/url cause
  // "invalid transport" errors. Conversion uses --ignore-user-config instead.
  return ["-c", 'model_reasoning_effort="low"'];
}

/** Write a project-scoped Codex config so runs work even without ~/.codex MCP setup. */
export async function ensureCodexProjectConfig(cwd: string): Promise<void> {
  const configDir = path.join(cwd, ".codex");
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(path.join(configDir, "config.toml"), PROJECT_CODEX_CONFIG, "utf-8");
}
