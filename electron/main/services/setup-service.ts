import { shell } from "../electron-api.js";
import type { SetupItem, SetupItemId, SetupStatus } from "./contract-types.js";
import { resolveCodexBinary } from "./codex-runner.js";
import { resolveClaudeBinary } from "./agent-provider.js";
import { installBrowser } from "./recording-service.js";
import {
  PLAYWRIGHT_MCP_VERSION,
  PLAYWRIGHT_VERSION,
} from "./setup-versions.js";
import { probePlaywrightSetup } from "./playwright-preflight.js";
import { ensurePlaywrightMcpInstalled } from "./playwright-mcp-install.js";

const SETUP_DOWNLOAD_URLS: Record<"codex" | "claude", string> = {
  codex: "https://github.com/openai/codex",
  claude: "https://docs.anthropic.com/en/docs/claude-code/quickstart",
};

function makeItem(
  id: SetupItemId,
  label: string,
  description: string,
  ready: boolean,
  options?: {
    detail?: string;
    installable?: boolean;
    downloadUrl?: string;
  },
): SetupItem {
  return {
    id,
    label,
    description,
    ready,
    detail: options?.detail,
    installable: options?.installable ?? false,
    downloadUrl: options?.downloadUrl,
  };
}

export async function checkSetupStatus(
  settings: {
    codexBinaryPath: string | null;
    claudeBinaryPath: string | null;
  },
): Promise<SetupStatus> {
  let codexPath: string | undefined;
  let codexReady = false;
  try {
    codexPath = await resolveCodexBinary(settings.codexBinaryPath);
    codexReady = true;
  } catch {
    // not installed
  }

  let claudePath: string | undefined;
  let claudeReady = false;
  try {
    claudePath = await resolveClaudeBinary(settings.claudeBinaryPath);
    claudeReady = true;
  } catch {
    // not installed
  }

  const probe = await probePlaywrightSetup();
  const playwright = probe.playwrightCli;
  const chromiumReady = probe.chromium.ready;
  const playwrightMcp = probe.playwrightMcp;

  const items: SetupItem[] = [
    makeItem(
      "codex",
      "Codex CLI",
      "Runs stories and converts recordings with OpenAI Codex.",
      codexReady,
      {
        detail: codexPath,
        downloadUrl: SETUP_DOWNLOAD_URLS.codex,
      },
    ),
    makeItem(
      "claude",
      "Claude Code CLI",
      "Alternative agent for running stories and recording conversion.",
      claudeReady,
      {
        detail: claudePath,
        downloadUrl: SETUP_DOWNLOAD_URLS.claude,
      },
    ),
    makeItem(
      "playwright",
      `Playwright CLI (${PLAYWRIGHT_VERSION})`,
      "Browser automation for headless recording and runs.",
      playwright.ready,
      {
        detail: playwright.ready
          ? playwright.version
            ? `v${playwright.version}${playwright.bundled ? " (bundled)" : ""}`
            : undefined
          : playwright.error,
      },
    ),
    makeItem(
      "playwright-mcp",
      `Playwright MCP (${PLAYWRIGHT_MCP_VERSION})`,
      "MCP server agents use to control the browser during runs. Ships with the app.",
      playwrightMcp.ready,
      {
        detail: playwrightMcp.ready
          ? `v${playwrightMcp.version ?? PLAYWRIGHT_MCP_VERSION} · handshake ok${playwrightMcp.bundled ? " · bundled" : ""}`
          : playwrightMcp.error ?? probe.npx.error,
        installable: !playwrightMcp.ready && !playwrightMcp.bundled,
      },
    ),
    makeItem(
      "chromium",
      "Chromium browser",
      "Required for headless recording and private-browser runs. Ships with the app.",
      chromiumReady,
      {
        detail: probe.chromium.bundled ? "bundled" : undefined,
        installable: !chromiumReady,
      },
    ),
  ];

  const essentialReady =
    (codexReady || claudeReady) &&
    playwright.ready &&
    playwrightMcp.ready &&
    chromiumReady;

  return {
    items,
    ready: essentialReady,
    playwrightVersion: PLAYWRIGHT_VERSION,
    playwrightMcpVersion: PLAYWRIGHT_MCP_VERSION,
  };
}

export async function installSetupItem(
  itemId: SetupItemId,
): Promise<{ ok: boolean; message: string; error?: string }> {
  switch (itemId) {
    case "chromium": {
      const res = await installBrowser();
      if (!res.ok) {
        return {
          ok: false,
          message: "Failed to install Chromium.",
          error: res.error,
        };
      }
      return { ok: true, message: "Chromium installed." };
    }
    case "playwright-mcp": {
      try {
        const cli = await ensurePlaywrightMcpInstalled();
        if (!cli) {
          return {
            ok: false,
            message: "Failed to prepare Playwright MCP.",
            error: "Bundled MCP missing and npm install failed.",
          };
        }
        return {
          ok: true,
          message: `Playwright MCP ${PLAYWRIGHT_MCP_VERSION} ready.`,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          ok: false,
          message: "Failed to prepare Playwright MCP.",
          error: msg,
        };
      }
    }
    case "codex":
    case "claude": {
      const url = SETUP_DOWNLOAD_URLS[itemId];
      await shell.openExternal(url);
      return { ok: true, message: "Opened download page in your browser." };
    }
    default:
      return {
        ok: false,
        message: "This item cannot be installed automatically.",
        error: `No install action for ${itemId}`,
      };
  }
}

export async function openSetupDownloadUrl(url: string): Promise<{ ok: true }> {
  await shell.openExternal(url);
  return { ok: true };
}
