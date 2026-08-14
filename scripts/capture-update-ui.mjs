#!/usr/bin/env node
/**
 * Capture in-app update chip states in the sidebar footer.
 *   STORY_STUDIO_MOCK_RUNS=1 xvfb-run -a node scripts/capture-update-ui.mjs
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

async function setUpdate(page, patch) {
  await page.evaluate((next) => window.electronAPI.invoke("updates:mockSet", next), patch);
  await wait(350);
}

async function clearHover(page) {
  await page.mouse.move(720, 360);
  await wait(250);
}

async function shotFooter(app, name) {
  const file = path.join(outDir, `${name}.png`);
  const png = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (!w) return null;
    const bounds = w.getBounds();
    const img = await w.capturePage({
      x: 0,
      y: Math.max(0, bounds.height - 72),
      width: 248,
      height: 72,
    });
    return img.toPNG().toString("base64");
  });
  if (!png) throw new Error("footer capturePage failed");
  fs.writeFileSync(file, Buffer.from(png, "base64"));
  console.log("wrote", file);
}

async function main() {
  ensureCursorThemeSettings();

  const app = await electron.launch({
    executablePath: electronExec(),
    args: [root],
    env: {
      ...process.env,
      STORY_STUDIO_MOCK_RUNS: "1",
      STORY_STUDIO_MOCK_UPDATE: "1",
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

  await setUpdate(page, { phase: "idle" });
  await clearHover(page);
  await shot(app, "01-update-idle-settings-right");
  await shotFooter(app, "01b-update-idle-footer");

  await setUpdate(page, {
    phase: "available",
    availableVersion: "1.6.0",
  });
  await clearHover(page);
  await shot(app, "02-update-available");
  await shotFooter(app, "02b-update-available-footer");
  await page.getByRole("button", { name: "Download update 1.6.0" }).hover();
  await wait(500);
  await shot(app, "02c-update-available-tooltip");
  await clearHover(page);

  await setUpdate(page, {
    phase: "downloading",
    availableVersion: "1.6.0",
    percent: 42,
  });
  await clearHover(page);
  await shot(app, "03-update-downloading");
  await shotFooter(app, "03b-update-downloading-footer");

  await setUpdate(page, {
    phase: "ready",
    availableVersion: "1.6.0",
  });
  await clearHover(page);
  await shot(app, "04-update-restart");
  await shotFooter(app, "04b-update-restart-footer");

  await setUpdate(page, {
    phase: "error",
    errorKind: "download",
    error: "Network request failed",
    availableVersion: "1.6.0",
  });
  await clearHover(page);
  await shot(app, "05-update-retry");
  await shotFooter(app, "05b-update-retry-footer");

  await app.close();
  console.log("done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
