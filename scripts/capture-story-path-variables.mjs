#!/usr/bin/env node
/**
 * Capture story-view file/folder path variables.
 *   STORY_STUDIO_MOCK_RUNS=1 xvfb-run -a node scripts/capture-story-path-variables.mjs
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

const fixturesDir = path.join(outDir, "story-path-fixtures");
fs.mkdirSync(fixturesDir, { recursive: true });
const htmlA = path.join(fixturesDir, "welcome.html");
fs.writeFileSync(
  htmlA,
  "<html><body><h1>Welcome email</h1><p>Hello from fixture A</p></body></html>\n",
);

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

async function main() {
  ensureCursorThemeSettings();

  const app = await electron.launch({
    executablePath: electronExec(),
    args: [root],
    env: {
      ...process.env,
      STORY_STUDIO_MOCK_RUNS: "1",
      STORY_STUDIO_MOCK_ATTACHMENTS: `${htmlA}:${fixturesDir}`,
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

  await page.getByRole("tab", { name: "Stories" }).click({ force: true });
  await wait(600);
  await page.getByText("Login Flow", { exact: true }).first().click({ force: true });
  await page.getByText("Variables", { exact: true }).waitFor();
  await wait(400);

  await page.getByRole("button", { name: "More actions" }).click({ force: true });
  await page.getByRole("menuitem", { name: /^Edit$/i }).click({ force: true });
  await page.getByRole("button", { name: /^Save$/i }).waitFor();
  await wait(400);

  const valueInputs = page.locator(".detail-var-row input[aria-label^='Variable value']");
  await valueInputs.last().click();
  await page.keyboard.press("Enter");
  await wait(200);

  const attachBtns = page.getByRole("button", { name: /Attach file or folder/i });
  await attachBtns.last().click({ force: true });
  await page.getByRole("menuitem", { name: /Attach file/i }).click({ force: true });
  await page.getByText("welcome.html").waitFor({ timeout: 5_000 });
  await wait(300);
  await shot(app, "story-path-var-file-attached");

  await attachBtns.last().click({ force: true });
  await page.getByRole("menuitem", { name: /Attach folder/i }).waitFor();
  await wait(200);
  await shot(app, "story-path-var-attach-menu");
  await page.keyboard.press("Escape");
  await wait(150);

  await page.getByRole("button", { name: /^Save$/i }).click({ force: true });
  await page.getByRole("button", { name: /Run story/i }).waitFor({ timeout: 10_000 });
  await wait(400);
  await shot(app, "story-path-var-readonly");

  await app.close();
  console.log("done", outDir);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
