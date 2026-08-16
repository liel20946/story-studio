#!/usr/bin/env node
/**
 * Capture screenshots for Apple design UI polish:
 *  home, stories, story detail, run, generate, scheduled, settings (appearance + agent)
 *
 * Prerequisites: npm run build && npm run seed:demo
 *   STORY_STUDIO_MOCK_RUNS=1 xvfb-run -a node scripts/capture-apple-design-ui.mjs
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

function ensureThemeSettings(theme) {
  const settingsPath = path.join(userDataDir(), "settings.json");
  let current = {};
  try {
    current = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  } catch {
    // fresh
  }
  const next = {
    ...current,
    theme,
    colorThemeDark: "cursor",
    colorThemeLight: "raycast",
    colorThemePaletteDark: null,
    colorThemePaletteLight: null,
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
    await new Promise((r) => setTimeout(r, 180));
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

async function captureSuite(theme) {
  ensureThemeSettings(theme);
  const prefix = `apple-design-${theme}`;

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
  await page.waitForLoadState("domcontentloaded");
  await wait(1800);

  await shot(app, `${prefix}-01-home`);

  // Stories tab
  const storiesTab = page.locator('.segment-control button[aria-label="Stories"]').first();
  if (await storiesTab.count()) {
    await storiesTab.click({ force: true });
    await wait(600);
  }
  await shot(app, `${prefix}-02-stories`);

  // Open first story if present
  const storyItem = page.locator(".sidebar-scroll button").first();
  if (await storyItem.count()) {
    await storyItem.click({ force: true });
    await wait(900);
    await shot(app, `${prefix}-03-story-detail`);
  }

  // Runs tab
  const runsTab = page.locator('.segment-control button[aria-label="Runs"]').first();
  if (await runsTab.count()) {
    await runsTab.click({ force: true });
    await wait(600);
    const runItem = page.locator(".sidebar-scroll button").first();
    if (await runItem.count()) {
      await runItem.click({ force: true });
      await wait(900);
      await shot(app, `${prefix}-04-run-detail`);
    }
  }

  // Generate
  const generateTab = page.locator('.segment-control button[aria-label="Generate"]').first();
  if (await generateTab.count()) {
    await generateTab.click({ force: true });
    await wait(800);
    await shot(app, `${prefix}-05-generate`);
  }

  // Scheduled
  const scheduledTab = page.locator('.segment-control button[aria-label="Scheduled"]').first();
  if (await scheduledTab.count()) {
    await scheduledTab.click({ force: true });
    await wait(800);
    await shot(app, `${prefix}-06-scheduled`);
  }

  await openSettings(page, "Appearance");
  await shot(app, `${prefix}-07-settings-appearance`);

  await openSettings(page, "Agent");
  await shot(app, `${prefix}-08-settings-agent`);

  await app.close();
}

async function main() {
  await captureSuite("dark");
  await captureSuite("light");
  console.log("done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
