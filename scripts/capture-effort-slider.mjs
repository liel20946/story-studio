#!/usr/bin/env node
/**
 * Capture screenshots for Generate effort slider.
 * Prerequisites: npm run build && npm run seed:demo
 *   STORY_STUDIO_MOCK_RUNS=1 xvfb-run -a node scripts/capture-effort-slider.mjs
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

  const page = await pageOrFirst(app);
  await page.waitForLoadState("domcontentloaded");
  await wait(2500);

  // Open New Story → Generate
  await page.getByRole("button", { name: "New story" }).click({ force: true });
  await wait(600);
  await page.getByRole("button", { name: /^Generate$/i }).click({ force: true });
  await wait(1000);
  await page.getByText("What story should we generate?").waitFor();

  // Open effort menu
  const effortBtn = page.getByRole("button", { name: "Reasoning effort" });
  await effortBtn.click({ force: true });
  await wait(500);
  await page.getByText("Faster").waitFor();

  const slider = page.getByRole("slider", { name: "Reasoning effort" });
  const box = await slider.boundingBox();
  if (!box) throw new Error("slider not found");

  // Move to Faster (left) first so we can prove a change
  await page.mouse.click(box.x + box.width * 0.12, box.y + box.height / 2);
  await wait(350);
  await shot(app, "effort-slider-open");
  const lowLabel = (await effortBtn.innerText()).trim();
  console.log("effort after left click:", lowLabel);

  // Then to Smarter (right)
  await page.mouse.click(box.x + box.width * 0.88, box.y + box.height / 2);
  await wait(400);
  await shot(app, "effort-slider-changed");
  const highLabel = (await effortBtn.innerText()).trim();
  console.log("effort after right click:", highLabel);
  if (lowLabel === highLabel) {
    throw new Error(`effort did not change: stayed "${highLabel}"`);
  }

  await shot(app, "effort-slider-final");
  await app.close();
  console.log("done");
}

async function pageOrFirst(app) {
  return app.firstWindow();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
