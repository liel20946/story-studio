#!/usr/bin/env node
/**
 * Capture Stories/History/Bulk tabs + light/dark themes.
 *
 * Prerequisites: npm run build && npm run seed:demo
 *   STORY_STUDIO_MOCK_RUNS=1 xvfb-run -a node scripts/capture-history-themes.mjs
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

async function captureSuite(theme) {
  ensureThemeSettings(theme);
  const prefix = `tabs-themes-${theme}`;

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

  await page.getByRole("tab", { name: "Stories" }).click({ force: true });
  await wait(500);
  await shot(app, `${prefix}-01-stories`);

  await page.getByRole("tab", { name: "History" }).click({ force: true });
  await wait(1000);
  await shot(app, `${prefix}-02-history`);

  await page.getByRole("tab", { name: "Bulk" }).click({ force: true });
  await wait(900);
  await shot(app, `${prefix}-03-bulk`);

  await page.keyboard.press("Control+Comma");
  await wait(900);
  await page.getByRole("button", { name: "Appearance", exact: true }).click({ force: true });
  await wait(700);
  await shot(app, `${prefix}-04-appearance`);

  await app.close();
}

async function main() {
  await captureSuite("light");
  await captureSuite("dark");
  console.log("done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
