#!/usr/bin/env node
/**
 * Capture settings copy fixes (browser / Codex extension / export) + scrolled Runs.
 *   STORY_STUDIO_MOCK_RUNS=1 xvfb-run -a node scripts/capture-settings-copy-scroll.mjs
 */
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

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

function ensureSettings() {
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
    browserMode: "codex-chrome",
    agentProvider: "codex",
  };
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, `${JSON.stringify(next, null, 2)}\n`);
}

function seedManyRuns() {
  const runsDir = path.join(userDataDir(), "runs");
  fs.mkdirSync(runsDir, { recursive: true });
  const runsJson = path.join(runsDir, "runs.json");
  let existing = [];
  try {
    existing = JSON.parse(fs.readFileSync(runsJson, "utf8"));
  } catch {
    existing = [];
  }
  const prefix = "scroll-ui-";
  existing = existing.filter((r) => !String(r.runId).startsWith(prefix));
  const now = Date.now();
  const titles = [
    "Issue Store Credit",
    "Gift Card Create",
    "Create Shopify Order",
    "Login Flow",
    "Checkout Flow",
    "Refund Order",
  ];
  const statuses = ["passed", "failed", "cancelled", "passed", "error"];
  const seeded = [];
  for (let i = 0; i < 28; i++) {
    const startedAt = now - (i + 1) * 60_000;
    seeded.push({
      runId: `${prefix}${String(i).padStart(2, "0")}-${randomUUID().slice(0, 8)}`,
      storyName: titles[i % titles.length].toLowerCase().replace(/\s+/g, "-"),
      storyTitle: titles[i % titles.length],
      status: statuses[i % statuses.length],
      summary: "All assertions passed",
      assertions: [],
      startedAt,
      finishedAt: startedAt + 12_000,
      agentProvider: "codex",
      agentModel: "gpt-5.6-terra",
      events: [],
    });
  }
  fs.writeFileSync(runsJson, `${JSON.stringify([...seeded, ...existing], null, 2)}\n`);
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

async function main() {
  ensureSettings();
  seedManyRuns();

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
  await wait(3500);

  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (!w) return;
    w.setMinimumSize(1200, 800);
    w.setSize(1440, 900);
    w.center();
    w.show();
  });
  await wait(600);

  // Settings → Agent (browser + Codex extension copy)
  await page.keyboard.press("Control+Comma");
  await wait(800);
  await page.getByRole("button", { name: "Agent", exact: true }).click({ force: true });
  await wait(500);
  const browserCodex = page
    .locator('[aria-label="Browser mode"]')
    .getByRole("tab", { name: "Codex" });
  if (await browserCodex.isVisible().catch(() => false)) {
    await browserCodex.click({ force: true });
    await wait(600);
  }
  await shot(app, "04-settings-browser-codex-copy");

  // Settings → Data (export copy)
  await page.getByRole("button", { name: "Data", exact: true }).click({ force: true });
  await wait(500);
  await shot(app, "05-settings-export-story-studio");

  await page.keyboard.press("Escape");
  await wait(500);

  // Runs tab fully expanded + hover for thin scrollbar
  await page.getByRole("tab", { name: "Runs" }).click({ force: true });
  await wait(600);
  for (let i = 0; i < 8; i++) {
    const btn = page.getByRole("button", { name: "Show more" });
    if ((await btn.count()) === 0) break;
    await btn.click({ force: true });
    await wait(200);
  }
  await page.evaluate(() => {
    const scroller = document.querySelector("aside .sidebar-scroll");
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  });
  await page.locator(".sidebar-scroll").hover({ force: true }).catch(() => {});
  await wait(250);
  await shot(app, "06-runs-sidebar-scrollbar");

  await app.close();
  console.log("done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
