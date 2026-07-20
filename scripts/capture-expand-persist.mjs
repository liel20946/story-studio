#!/usr/bin/env node
/**
 * Capture Show-more expand persistence across tab switches.
 *   STORY_STUDIO_MOCK_RUNS=1 xvfb-run -a node scripts/capture-expand-persist.mjs
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

const RUN_COUNT = 20;
const STORY_COUNT = 16;
const TITLES = [
  "Issue Store Credit",
  "Gift Card Create",
  "Create Shopify Order",
  "Login Flow",
  "Checkout Flow",
  "Refund Order",
  "Password Reset",
  "Cart Update",
];

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

function clearExpandState() {
  // Electron localStorage lives in the Chromium profile; we also clear any
  // leftover key via page.evaluate after launch. This is a no-op placeholder
  // for clarity — expand state is renderer localStorage.
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
  const prefix = "expand-persist-";
  existing = existing.filter((r) => !String(r.runId).startsWith(prefix));
  const now = Date.now();
  const seeded = [];
  for (let i = 0; i < RUN_COUNT; i++) {
    const startedAt = now - (i + 1) * 60_000;
    const finishedAt = startedAt + 12_000;
    const title = TITLES[i % TITLES.length];
    seeded.push({
      runId: `${prefix}${String(i).padStart(2, "0")}-${randomUUID().slice(0, 8)}`,
      storyName: title.toLowerCase().replace(/\s+/g, "-"),
      storyTitle: title,
      status: i % 4 === 1 ? "failed" : "passed",
      summary: i % 4 === 1 ? "Assertion failed" : "All assertions passed",
      assertions: [],
      startedAt,
      finishedAt,
      agentProvider: "codex",
      agentModel: "gpt-5.6-terra",
      events: [],
    });
  }
  fs.writeFileSync(runsJson, `${JSON.stringify([...seeded, ...existing], null, 2)}\n`);
  console.log(`seeded ${RUN_COUNT} runs`);
}

function seedManyStories() {
  const storiesDir = path.join(userDataDir(), "stories");
  fs.mkdirSync(storiesDir, { recursive: true });
  const now = Date.now();
  const stories = [];
  for (let i = 0; i < STORY_COUNT; i++) {
    const title = `${TITLES[i % TITLES.length]} ${i + 1}`;
    const id = `expand-persist-${String(i).padStart(2, "0")}`;
    stories.push(`  - id: ${id}
    name: ${JSON.stringify(title)}
    url: https://example.com
    mode: manual
    workflow: |-
      Open https://example.com
      Do the thing
    assertions: |-
      @2 Verify success
    created_at: ${now - i * 60_000}`);
  }
  const yaml = `stories:
${stories.join("\n\n")}
`;
  fs.writeFileSync(path.join(storiesDir, "expand-persist.yaml"), yaml);
  console.log(`seeded ${STORY_COUNT} stories`);
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

async function clickShowMore(page, times = 1) {
  for (let i = 0; i < times; i++) {
    const btn = page.getByRole("button", { name: "Show more" });
    if ((await btn.count()) === 0) break;
    await btn.click({ force: true });
    await wait(250);
  }
}

async function main() {
  ensureCursorThemeSettings();
  clearExpandState();
  seedManyRuns();
  seedManyStories();

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

  // Reset expand prefs so this capture starts collapsed.
  await page.evaluate(() => {
    localStorage.removeItem("story-studio-expand-v1");
  });

  // --- Runs: expand, switch away, switch back ---
  await page.getByRole("tab", { name: "Runs" }).click({ force: true });
  await wait(800);
  await shot(app, "01-runs-collapsed");

  await clickShowMore(page, 2);
  await wait(400);
  await shot(app, "02-runs-expanded");

  await page.getByRole("tab", { name: "Stories" }).click({ force: true });
  await wait(700);
  await shot(app, "03-stories-after-switch");

  await page.getByRole("tab", { name: "Runs" }).click({ force: true });
  await wait(700);
  await shot(app, "04-runs-still-expanded");

  // --- Stories: expand, switch away, switch back ---
  await page.getByRole("tab", { name: "Stories" }).click({ force: true });
  await wait(700);
  await clickShowMore(page, 1);
  await wait(400);
  await shot(app, "05-stories-expanded");

  await page.getByRole("tab", { name: "Runs" }).click({ force: true });
  await wait(700);
  await page.getByRole("tab", { name: "Stories" }).click({ force: true });
  await wait(700);
  await shot(app, "06-stories-still-expanded");

  await app.close();
  console.log("done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
