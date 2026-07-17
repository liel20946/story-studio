import { ipcMain } from "../electron-api.js";
import type { SetupItemId } from "../services/contract-types.js";
import {
  checkSetupStatus,
  installSetupItem,
  openSetupDownloadUrl,
} from "../services/setup-service.js";
import { getSettingsValue } from "./settings.js";
import {
  clearBrowserExtensionToken,
  hasBrowserExtensionToken,
  saveBrowserExtensionToken,
} from "../services/browser-extension-auth.js";
import { probeExistingChromeConnection } from "../services/playwright-preflight.js";

const SETUP_ITEM_IDS = new Set<SetupItemId>([
  "codex",
  "claude",
  "playwright",
  "playwright-mcp",
  "chromium",
]);

export function registerSetupHandlers(): void {
  ipcMain.handle("setup:check", async () => {
    const settings = getSettingsValue();
    return checkSetupStatus({
      codexBinaryPath: settings.codexBinaryPath,
      claudeBinaryPath: settings.claudeBinaryPath,
    });
  });

  ipcMain.handle("setup:install", async (_event, params: unknown) => {
    if (
      typeof params !== "object" ||
      params === null ||
      typeof (params as Record<string, unknown>)["item"] !== "string"
    ) {
      throw new Error("setup:install requires { item: SetupItemId }");
    }
    const item = (params as { item: string }).item;
    if (!SETUP_ITEM_IDS.has(item as SetupItemId)) {
      throw new Error(`Unknown setup item: ${item}`);
    }
    return installSetupItem(item as SetupItemId);
  });

  ipcMain.handle("setup:openUrl", async (_event, params: unknown) => {
    if (
      typeof params !== "object" ||
      params === null ||
      typeof (params as Record<string, unknown>)["url"] !== "string"
    ) {
      throw new Error("setup:openUrl requires { url: string }");
    }
    const { url } = params as { url: string };
    return openSetupDownloadUrl(url);
  });

  ipcMain.handle("browser:extensionTokenStatus", async () => ({
    configured: await hasBrowserExtensionToken(),
  }));

  ipcMain.handle("browser:setExtensionToken", async (_event, params: unknown) => {
    if (
      typeof params !== "object" ||
      params === null ||
      typeof (params as Record<string, unknown>)["token"] !== "string"
    ) {
      throw new Error("browser:setExtensionToken requires { token: string }");
    }
    await saveBrowserExtensionToken(
      (params as { token: string }).token,
    );
    return { configured: true as const };
  });

  ipcMain.handle("browser:clearExtensionToken", async () => {
    await clearBrowserExtensionToken();
    return { configured: false as const };
  });

  ipcMain.handle("browser:testExtensionConnection", async () => {
    const result = await probeExistingChromeConnection();
    return result.ready
      ? { ok: true as const, message: "Connected to Chrome successfully." }
      : {
          ok: false as const,
          message:
            result.error ??
            "Could not connect to Chrome. Install the Playwright MCP Bridge extension and try again.",
        };
  });
}
