import * as fs from "fs/promises";
import * as path from "path";

/** Codex `-c` overrides that fully define the headless Playwright MCP server for runs. */
export function buildCodexMcpConfigArgs(): string[] {
  return [
    "-c",
    "mcp_servers.node_repl.enabled=false",
    "-c",
    "mcp_servers.playwright.enabled=true",
    "-c",
    'mcp_servers.playwright.command="npx"',
    "-c",
    'mcp_servers.playwright.args=["-y","@playwright/mcp@latest","--headless","--isolated"]',
    "-c",
    "mcp_servers.playwright.startup_timeout_sec=60",
  ];
}

const PROJECT_CODEX_CONFIG = `[mcp_servers.playwright]
command = "npx"
args = ["-y", "@playwright/mcp@latest", "--headless", "--isolated"]
enabled = true
startup_timeout_sec = 60

[mcp_servers.node_repl]
enabled = false
`;

/** Write a project-scoped Codex config so runs work even without ~/.codex MCP setup. */
export async function ensureCodexProjectConfig(cwd: string): Promise<void> {
  const configDir = path.join(cwd, ".codex");
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(path.join(configDir, "config.toml"), PROJECT_CODEX_CONFIG, "utf-8");
}
