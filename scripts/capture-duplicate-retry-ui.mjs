#!/usr/bin/env node
/**
 * Capture real Story Studio screenshots for:
 *  1) Story View — Duplicate story toolbar button
 *  2) History Run View — Retry run toolbar button
 *
 * Prerequisites: npm run build && npm run seed:demo
 *   STORY_STUDIO_MOCK_RUNS=1 xvfb-run -a node scripts/capture-duplicate-retry-ui.mjs
 */
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
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

  // Open Login Flow story from the sidebar.
  await page.getByText("Login Flow", { exact: true }).first().click({ force: true });
  await page.getByRole("button", { name: "Duplicate story" }).waitFor({ timeout: 15_000 });
  await wait(800);
  await shot(app, "01-story-view-duplicate-button");

  // Hover the duplicate button so the tooltip is visible.
  await page.getByRole("button", { name: "Duplicate story" }).hover();
  await wait(400);
  await shot(app, "02-story-view-duplicate-tooltip");

  // Switch sidebar to Runs and open the first finished run.
  await page.getByRole("tab", { name: "Runs" }).click({ force: true });
  await wait(800);

  const runRow = page
    .locator(".group\\/row")
    .filter({ hasText: /Login Flow|Checkout|Onboarding|Settings/i })
    .first();
  await runRow.waitFor({ timeout: 10_000 });
  await runRow.click({ force: true });
  await wait(1200);

  // Finished history runs show Retry; if still live, wait for finish.
  const retryBtn = page.getByRole("button", { name: "Retry run" });
  if (!(await retryBtn.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: /^Run$/i }).click({ force: true }).catch(() => {});
    await retryBtn.waitFor({ timeout: 25_000 });
  }
  await wait(600);
  await shot(app, "03-run-view-retry-button");

  await retryBtn.hover();
  await wait(300);
  await shot(app, "04-run-view-retry-hover");

  await app.close();
  console.log("done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
