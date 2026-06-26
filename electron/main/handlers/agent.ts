import { ipcMain } from "../electron-api.js";
import {
  getAllCachedAgentCapabilities,
  getCachedAgentCapabilities,
} from "../services/agent-capabilities.js";
import type { AgentProvider } from "../services/agent-provider.js";

export function registerAgentHandlers(): void {
  ipcMain.handle("agent:getAllCapabilities", async () => {
    return getAllCachedAgentCapabilities();
  });

  ipcMain.handle("agent:getCapabilities", async (_event, params: unknown) => {
    const provider: AgentProvider =
      typeof params === "object" &&
      params !== null &&
      (params as Record<string, unknown>)["provider"] === "claude-code"
        ? "claude-code"
        : "codex";

    return getCachedAgentCapabilities(provider);
  });
}
