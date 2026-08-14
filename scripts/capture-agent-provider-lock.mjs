#!/usr/bin/env node
/**
 * Capture Settings → Agent provider lock states (missing Codex / Claude Code).
 * Prerequisites: npm run build && npm run seed:demo
 *   STORY_STUDIO_MOCK_RUNS=1 xvfb-run -a node scripts/capture-agent-provider-lock.mjs
 */
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { _electron: electron } = require("playwright");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outDir = path.join(
  process.env.CURSOR_ARTIFACTS_DIR || "/opt/cursor/artifacts",
  "screenshots",
);
fs.mkdirSync(outDir, { recursive: true });

function userDataDir() {
  return path.join(os.homedir(), ".config/Story Studio");
}

function ensureSettings(agentProvider = "codex") {
  const settingsPath = path.join(userDataDir(), "settings.json");
  let current = {};
  try {
    current = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  } catch {
    // fresh
  }
  const next = {
    ...current,
    theme: "dark",
    colorThemeDark: "cursor",
    colorThemePaletteDark: null,
    browserMode: "private",
    agentProvider,
  };
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, `${JSON.stringify(next, null, 2)}\n`);
}

function electronExec() {
  const electronPath = path.dirname(require.resolve("electron"));
  const relative = fs.readFileSync(path.join(electronPath, "path.txt"), "utf8").trim();
  return path.join(electronPath, "dist", relative);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(app, name) {
  const file = path.join(outDir, `${name}.png`);
  const png = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (!w) return null;
    w.setBounds({ x: 20, y: 20, width: 1440, height: 900 });
    w.show();
    w.focus();
    await new Promise((r) => setTimeout(r, 150));
    const img = await w.capturePage();
    return img.toPNG().toString("base64");
  });
  if (!png) throw new Error("capturePage failed");
  fs.writeFileSync(file, Buffer.from(png, "base64"));
  console.log("wrote", file);
}

async function openAgentSettings(page) {
  await page.keyboard.press("Control+Comma");
  await wait(800);
  const agentNav = page.getByRole("button", { name: "Agent", exact: true });
  if (await agentNav.isVisible().catch(() => false)) {
    await agentNav.click({ force: true });
    await wait(500);
  }
  await page.getByText("Provider", { exact: true }).first().waitFor();
  await wait(400);
}

async function launchAgentSettings({
  codex,
  claude,
  agentProvider = "codex",
}) {
  ensureSettings(agentProvider);
  const app = await electron.launch({
    executablePath: electronExec(),
    args: [root],
    env: {
      ...process.env,
      STORY_STUDIO_MOCK_RUNS: "1",
      STORY_STUDIO_MOCK_SETUP_CODEX: codex ? "1" : "0",
      STORY_STUDIO_MOCK_SETUP_CLAUDE: claude ? "1" : "0",
      ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
    },
    timeout: 120_000,
  });

  const page = await app.firstWindow();
  page.setDefaultTimeout(25_000);
  await page.waitForLoadState("domcontentloaded");
  await wait(3000);

  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (!w) return;
    w.setMinimumSize(1200, 800);
    w.setSize(1440, 900);
    w.center();
    w.show();
  });
  await wait(500);
  await openAgentSettings(page);
  return { app, page };
}

async function main() {
  const codexOnly = await launchAgentSettings({
    codex: true,
    claude: false,
    agentProvider: "codex",
  });
  await shot(codexOnly.app, "01-agent-provider-codex-only");
  await codexOnly.page
    .locator('[aria-label="Agent provider"]')
    .getByRole("tab", { name: "Claude Code" })
    .hover();
  await wait(500);
  await shot(codexOnly.app, "02-agent-provider-codex-only-claude-tooltip");
  await codexOnly.app.close();

  const claudeOnly = await launchAgentSettings({
    codex: false,
    claude: true,
    agentProvider: "codex",
  });
  await shot(claudeOnly.app, "03-agent-provider-claude-only");
  await claudeOnly.page
    .locator('[aria-label="Agent provider"]')
    .getByRole("tab", { name: "Codex" })
    .hover();
  await wait(500);
  await shot(claudeOnly.app, "04-agent-provider-claude-only-codex-tooltip");
  await claudeOnly.app.close();

  const neither = await launchAgentSettings({
    codex: false,
    claude: false,
    agentProvider: "codex",
  });
  await shot(neither.app, "05-agent-provider-neither");
  await neither.app.close();

  const both = await launchAgentSettings({
    codex: true,
    claude: true,
    agentProvider: "codex",
  });
  await shot(both.app, "06-agent-provider-both-available");
  await both.app.close();

  console.log("done", outDir);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
