#!/usr/bin/env node
/**
 * Capture Open in provider on finished + live story RUN views (More menu).
 *   STORY_STUDIO_MOCK_RUNS=1 xvfb-run -a node scripts/capture-open-in-finished.mjs
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

async function openMoreMenu(page) {
  await page.getByRole("button", { name: "More actions" }).click();
  await wait(400);
  await page.getByRole("menuitem", { name: /Open in Codex/i }).waitFor({
    timeout: 10_000,
  });
}

async function openHistoryRun(page, titlePart) {
  await page.getByRole("tab", { name: "Runs" }).click({ force: true });
  await wait(800);
  await page
    .locator(".group\\/row")
    .filter({ hasText: titlePart })
    .first()
    .click({ force: true });
  await page.getByText("Actions").first().waitFor({ timeout: 20_000 });
  await wait(800);
  await openMoreMenu(page);
}

async function main() {
  ensureCursorThemeSettings();

  const app = await electron.launch({
    executablePath: electronExec(),
    args: [root],
    env: {
      ...process.env,
      STORY_STUDIO_MOCK_RUNS: "1",
      STORY_STUDIO_MOCK_RUN_MS: "8000",
      ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
    },
    timeout: 120_000,
  });

  try {
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

    await openHistoryRun(page, "Login Flow");
    await shot(app, "open-in-01-finished-run-more-menu");
    await page.keyboard.press("Escape");
    await wait(300);

    // Start a live mock run and confirm Open in appears while Running.
    await page.getByRole("tab", { name: "Stories" }).click({ force: true });
    await wait(600);
    await page
      .locator(".group\\/row")
      .filter({ hasText: "Login Flow" })
      .first()
      .click({ force: true });
    await wait(800);
    await page.getByRole("button", { name: /^Run$/i }).click({ force: true });
    await page.getByRole("button", { name: "Cancel run" }).waitFor({
      timeout: 15_000,
    });
    await wait(900);
    await openMoreMenu(page);
    await shot(app, "open-in-02-live-run-more-menu");
  } finally {
    await app.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
