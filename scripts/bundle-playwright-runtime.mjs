#!/usr/bin/env node
/**
 * Download the pinned Playwright MCP package and Chromium browsers into
 * resources/ so electron-builder can ship them via extraResources.
 *
 * MCP's playwright (1.62 alpha) and the app CLI (1.46.1) need different
 * Chromium revisions — both are installed into the same browsers dir.
 *
 *   PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 is set during npm install so browsers
 *   land only in resources/ms-playwright, not inside the MCP node_modules.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const mcpDir = path.join(root, "resources", "playwright-mcp");
const browsersDir = path.join(root, "resources", "ms-playwright");

function readPinnedMcpVersion() {
  const src = fs.readFileSync(
    path.join(root, "electron/main/services/setup-versions.ts"),
    "utf8",
  );
  const match = src.match(/PLAYWRIGHT_MCP_VERSION\s*=\s*"([^"]+)"/);
  if (!match) {
    throw new Error("Could not read PLAYWRIGHT_MCP_VERSION from setup-versions.ts");
  }
  return match[1];
}

function run(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed (${result.status})`);
  }
}

const mcpVersion = readPinnedMcpVersion();
console.log(`[bundle-playwright] MCP @playwright/mcp@${mcpVersion}`);

fs.mkdirSync(mcpDir, { recursive: true });
fs.writeFileSync(
  path.join(mcpDir, "package.json"),
  `${JSON.stringify({ name: "story-studio-mcp-host", private: true }, null, 2)}\n`,
);

run(
  "npm",
  [
    "install",
    `@playwright/mcp@${mcpVersion}`,
    "--prefix",
    mcpDir,
    "--no-save",
    "--no-audit",
    "--no-fund",
    "--loglevel",
    "error",
  ],
  { PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1" },
);

fs.mkdirSync(browsersDir, { recursive: true });
const browserEnv = { PLAYWRIGHT_BROWSERS_PATH: browsersDir };

const appCli = path.join(root, "node_modules", "playwright", "cli.js");
if (fs.existsSync(appCli)) {
  console.log("[bundle-playwright] installing Chromium for app Playwright CLI");
  run(process.execPath, [appCli, "install", "chromium"], browserEnv);
} else {
  console.warn("[bundle-playwright] app Playwright CLI missing — skip 1.46 Chromium");
}

const mcpCli = path.join(mcpDir, "node_modules", "playwright", "cli.js");
if (fs.existsSync(mcpCli)) {
  console.log("[bundle-playwright] installing Chromium for Playwright MCP");
  run(process.execPath, [mcpCli, "install", "chromium", "--no-shell"], browserEnv);
} else {
  throw new Error(`Playwright CLI missing after MCP install: ${mcpCli}`);
}

console.log("[bundle-playwright] done", { mcpDir, browsersDir });
