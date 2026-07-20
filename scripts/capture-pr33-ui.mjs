#!/usr/bin/env node
/**
 * Capture screenshots for PR #33 UI changes:
 *  1) Settings nav order (Agent before Appearance) + Agent browser options
 *  2) Wider settings card / effort row
 *  3) Story duplicate auto-select
 *  4) Run view without Copy logs
 *  5) Generate approve/questions panel (opaque on Cursor theme)
 *
 * Prerequisites: npm run build && npm run seed:demo
 *   STORY_STUDIO_MOCK_RUNS=1 xvfb-run -a node scripts/capture-pr33-ui.mjs
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

function ensureCursorThemeSettings() {
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
    agentProvider: "codex",
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

async function openSettings(page, sectionLabel) {
  await page.keyboard.press("Control+Comma");
  await wait(900);
  await page.getByRole("button", { name: sectionLabel, exact: true }).click({ force: true });
  await wait(700);
}

async function main() {
  ensureCursorThemeSettings();

  const app = await electron.launch({
    executablePath: electronExec(),
    args: [root],
    env: {
      ...process.env,
      STORY_STUDIO_MOCK_RUNS: "1",
      ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
    },
    timeout: 120_000,
  });

  const page = await app.firstWindow();
  page.setDefaultTimeout(30_000);
  await page.waitForLoadState("domcontentloaded");
  await wait(4000);

  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (!w) return;
    w.setMinimumSize(1200, 800);
    w.setSize(1440, 900);
    w.center();
    w.show();
  });
  await wait(800);

  // --- Settings: Agent first in nav + browser options / wider card ---
  await openSettings(page, "Agent");
  await wait(600);
  await shot(app, "01-settings-agent-nav-and-browser");

  // Switch browser to Playwright to show extension/token rows
  const playwrightSeg = page.getByRole("tab", { name: "Playwright" });
  if (await playwrightSeg.isVisible().catch(() => false)) {
    await playwrightSeg.click({ force: true });
    await wait(700);
    await shot(app, "02-settings-browser-playwright");
  }

  // Switch to Codex browser mode
  const codexSeg = page.getByRole("tab", { name: "Codex", exact: true });
  // There may be provider "Codex" and browser "Codex" — pick the browser row one
  const browserCodex = page
    .locator('[aria-label="Browser mode"]')
    .getByRole("tab", { name: "Codex" });
  if (await browserCodex.isVisible().catch(() => false)) {
    await browserCodex.click({ force: true });
    await wait(900);
    await shot(app, "03-settings-browser-codex");
  } else if (await codexSeg.isVisible().catch(() => false)) {
    // fallback: last Codex tab
    const tabs = page.getByRole("tab", { name: "Codex" });
    const count = await tabs.count();
    await tabs.nth(count - 1).click({ force: true });
    await wait(900);
    await shot(app, "03-settings-browser-codex");
  }

  // Appearance still present (after Agent in sidebar)
  await page.getByRole("button", { name: "Appearance", exact: true }).click({ force: true });
  await wait(600);
  await shot(app, "04-settings-appearance-after-agent");

  // Leave settings
  await page.keyboard.press("Escape");
  await wait(500);
  // Click Stories if still on settings
  const storiesTab = page.getByRole("tab", { name: "Stories" });
  if (await storiesTab.isVisible().catch(() => false)) {
    await storiesTab.click({ force: true });
    await wait(600);
  }

  // --- Duplicate story auto-select ---
  await page.getByText("Login Flow", { exact: true }).first().click({ force: true });
  await wait(1000);
  const dupBtn = page.getByRole("button", { name: "Duplicate story" });
  await dupBtn.waitFor({ timeout: 15_000 });
  await shot(app, "05-story-before-duplicate");
  await dupBtn.click({ force: true });
  await wait(1500);
  await shot(app, "06-story-after-duplicate-selected");

  // --- Run view: no Copy logs ---
  await page.getByRole("tab", { name: "Runs" }).click({ force: true });
  await wait(900);
  const runRow = page
    .locator(".group\\/row")
    .filter({ hasText: /Login Flow|Checkout|Onboarding|Settings/i })
    .first();
  await runRow.waitFor({ timeout: 10_000 });
  await runRow.click({ force: true });
  await wait(1200);
  await shot(app, "07-run-view-no-copy-logs");

  // --- Generate approve draft (opaque questions panel on Cursor theme) ---
  await page.getByRole("tab", { name: "Generate" }).click({ force: true });
  await wait(900);
  const giftCard = page.getByText("Gift card purchase flow", { exact: true }).first();
  if (await giftCard.isVisible().catch(() => false)) {
    await giftCard.click({ force: true });
    await wait(1500);
    // Expand draft if needed
    const approve = page.getByText("Approve draft?", { exact: true });
    if (!(await approve.isVisible().catch(() => false))) {
      // scroll chat to bottom
      await page.evaluate(() => {
        const scroller = document.querySelector(".generate-chat-body, [data-radix-scroll-area-viewport]");
        if (scroller) scroller.scrollTop = scroller.scrollHeight;
      });
      await wait(500);
    }
    await shot(app, "08-generate-approve-opaque");
  }

  await app.close();
  console.log("done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
