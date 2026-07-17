import * as fs from "fs/promises";
import * as path from "path";
import { projectCodexConfigToml } from "./browser-mcp-config.js";

export {
  buildCodexPlaywrightMcpConfigArgs,
  playwrightMcpSecretEnv,
} from "./browser-mcp-config.js";

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
  const contents = await projectCodexConfigToml();
  const configPath = path.join(configDir, "config.toml");
  await fs.writeFile(configPath, contents, "utf-8");
  console.log("[mcp] wrote Codex project config", { configPath });
}
