#!/usr/bin/env node
/**
 * Capture screenshots for New Story modal + bulk Variables label UI.
 * Prerequisites: npm run build && npm run seed:demo
 *   STORY_STUDIO_MOCK_RUNS=1 xvfb-run -a node scripts/capture-new-story-bulk-vars.mjs
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

async function openBulkSelection(page) {
  const homeCta = page.getByRole("button", { name: /^Run stories$/i });
  if (await homeCta.isVisible().catch(() => false)) {
    await homeCta.click({ force: true });
  } else {
    await page.getByRole("button", { name: "Run stories" }).first().click({ force: true });
  }
  await wait(1200);
  const runMore = page.getByRole("button", { name: /Run more/i });
  if (await runMore.isVisible().catch(() => false)) {
    await runMore.click({ force: true });
    await wait(600);
  }
  await page.getByText("Stop condition").waitFor();
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

  await page.evaluate(() => {
    try {
      sessionStorage.removeItem("story-studio:bulk-session");
      sessionStorage.removeItem("story-studio:bulk-launched");
      sessionStorage.removeItem("story-studio:bulk-variable-plans");
    } catch {
      /* ignore */
    }
  });

  // --- New Story modal (no subtitles) ---
  await page.getByRole("button", { name: /^New story$/i }).click({ force: true });
  await page.getByRole("heading", { name: "New Story" }).waitFor();
  await wait(400);
  await shot(app, "01-new-story-modal-simplified");

  await page.keyboard.press("Escape");
  await wait(400);

  // --- Bulk run: Variables text button ---
  await openBulkSelection(page);
  await wait(400);
  await shot(app, "02-bulk-variables-label");

  const loginRow = page.getByRole("main").getByText("Login Flow", { exact: true });
  await loginRow.hover();
  await wait(300);
  await shot(app, "03-bulk-variables-label-hover");

  await page
    .getByRole("button", { name: /Configure variable runs for Login Flow/i })
    .click({ force: true });
  await page.getByText(/Variable runs[:\s].*Login Flow/i).waitFor();
  await wait(400);
  await shot(app, "04-bulk-variables-modal");

  await app.close();
  console.log("done", outDir);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
