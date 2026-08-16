#!/usr/bin/env node
/**
 * Capture Cursor-theme popups to verify opaque surfaces.
 * Prerequisites: npm run build && npm run seed:demo
 *   STORY_STUDIO_MOCK_RUNS=1 xvfb-run -a node scripts/capture-opaque-popups.mjs
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

async function readSurfaceStyles(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      backgroundColor: cs.backgroundColor,
      opacity: cs.opacity,
      backdropFilter: cs.backdropFilter,
      surfacePopover: getComputedStyle(document.documentElement)
        .getPropertyValue("--color-surface-popover")
        .trim(),
      glassBg: getComputedStyle(document.documentElement)
        .getPropertyValue("--glass-bg")
        .trim(),
    };
  }, selector);
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

  try {
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await wait(2500);

    // --- New Story ---
    await page.getByRole("button", { name: /^New story$/i }).first().click();
    await page.getByRole("heading", { name: "New Story" }).waitFor();
    await wait(400);
    console.log("new-story styles", await readSurfaceStyles(page, ".dialog-surface"));
    await shot(app, "opaque-dialog-01-new-story");
    await page.keyboard.press("Escape");
    await wait(300);

    // --- New Section ---
    const newSection = page.getByRole("button", { name: /^New section$/i }).first();
    await newSection.click();
    await page.getByRole("heading", { name: "New Section" }).waitFor();
    await wait(400);
    console.log("new-section styles", await readSurfaceStyles(page, ".dialog-surface"));
    await shot(app, "opaque-dialog-02-new-section");
    await page.keyboard.press("Escape");
    await wait(300);

    // --- Command search ---
    await page.keyboard.press("Meta+k");
    await wait(200);
    await page.keyboard.press("Control+k");
    await wait(500);
    const cmd = page.locator(".command-search-panel");
    if (await cmd.isVisible().catch(() => false)) {
      console.log("command-search styles", await readSurfaceStyles(page, ".command-search-panel"));
      await shot(app, "opaque-dialog-04-command-search");
      await page.keyboard.press("Escape");
      await wait(300);
    } else {
      console.log("command-search panel not visible, skipping");
    }

    // --- More menu on a finished run ---
    const runItem = page.locator(".sidebar-item").filter({ hasText: /Checkout|Login|Failed|Passed/i }).first();
    if (await runItem.isVisible().catch(() => false)) {
      await runItem.click();
      await wait(800);
      const more = page.getByRole("button", { name: /^More$/i }).first();
      if (await more.isVisible().catch(() => false)) {
        await more.click();
        await wait(400);
        console.log("more-menu styles", await readSurfaceStyles(page, ".toolbar-more-menu"));
        await shot(app, "opaque-dialog-03-more-menu");
        await page.keyboard.press("Escape");
      }
    }
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
