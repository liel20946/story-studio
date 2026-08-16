#!/usr/bin/env node
/**
 * Capture screenshots for Generate-in-New-Story flow.
 * Prerequisites: npm run build && npm run seed:demo
 *   STORY_STUDIO_MOCK_RUNS=1 xvfb-run -a node scripts/capture-generate-in-new-story.mjs
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

  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await wait(2500);

  // Sidebar should show Stories | Runs | Scheduled (no Generate tab)
  await shot(app, "generate-in-new-story-sidebar-tabs");

  // Open New Story chooser via Plus
  const newStory = page.getByRole("button", { name: "New story" });
  await newStory.click({ force: true });
  await wait(800);
  await page.getByRole("heading", { name: "New Story" }).waitFor();
  await shot(app, "generate-in-new-story-chooser");

  // Choose Generate → chat composer
  await page.getByRole("button", { name: /^Generate$/i }).click({ force: true });
  await wait(1200);
  await page.getByText("What story should we generate?").waitFor();
  await shot(app, "generate-in-new-story-chat");

  await app.close();
  console.log("done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
