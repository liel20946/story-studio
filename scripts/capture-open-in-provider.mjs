#!/usr/bin/env node
/**
 * Capture run view with Open in Codex / Open in Claude toolbar button.
 *   STORY_STUDIO_MOCK_RUNS=1 xvfb-run -a node scripts/capture-open-in-provider.mjs
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

function ensureCursorThemeSettings(agentProvider) {
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
    agentProvider,
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

async function captureRun(name, agentProvider, buttonName) {
  ensureCursorThemeSettings(agentProvider);

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

    await page.getByRole("tab", { name: "Runs" }).click({ force: true });
    await wait(800);
    await page
      .locator(".group\\/row")
      .filter({ hasText: "Login Flow" })
      .first()
      .click({ force: true });
    await page.getByText("Actions").first().waitFor({ timeout: 20_000 });
    await wait(800);

    const openBtn = page.getByRole("button", { name: buttonName });
    await openBtn.waitFor({ timeout: 10_000 });
    await wait(400);

    await shot(app, name);
  } finally {
    await app.close().catch(() => {});
  }
}

async function main() {
  await captureRun("01-run-open-in-codex", "codex", "Open in Codex");

  // Patch the seeded Login Flow run to Claude so the button label updates.
  const runsJson = path.join(userDataDir(), "runs", "runs.json");
  const runs = JSON.parse(fs.readFileSync(runsJson, "utf8"));
  for (const run of runs) {
    if (run.storyTitle === "Login Flow" || run.runId?.includes("login")) {
      run.agentProvider = "claude-code";
      run.agentModel = "sonnet";
      run.providerSessionId =
        run.providerSessionId || `demo-session-${run.runId}`;
    }
  }
  fs.writeFileSync(runsJson, `${JSON.stringify(runs, null, 2)}\n`);

  await captureRun("02-run-open-in-claude", "claude-code", "Open in Claude");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
