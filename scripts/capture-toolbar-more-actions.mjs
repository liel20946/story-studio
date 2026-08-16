#!/usr/bin/env node
/**
 * Capture toolbar More + primary CTA cleanup across views:
 *  1) Story — closed / open
 *  2) Finished run — closed / open
 *  3) Bulk selection — closed / open
 *  4) New schedule — closed / open
 *
 * Prerequisites: npm run build && npm run seed:demo
 *   STORY_STUDIO_MOCK_RUNS=1 xvfb-run -a node scripts/capture-toolbar-more-actions.mjs
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

async function captureMorePair(app, page, baseName, menuItemName) {
  await page.getByRole("button", { name: "More actions" }).waitFor({ timeout: 15_000 });
  await wait(350);
  await shot(app, `${baseName}-closed`);
  await page.getByRole("button", { name: "More actions" }).click({ force: true });
  await page.getByRole("menuitem", { name: menuItemName }).waitFor({ timeout: 5_000 });
  await wait(250);
  await shot(app, `${baseName}-open`);
  await page.keyboard.press("Escape");
  await wait(200);
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

  // --- Story ---
  await page.getByText("Login Flow", { exact: true }).first().click({ force: true });
  await page.getByRole("button", { name: /^Run$/i }).waitFor({ timeout: 5_000 });
  await captureMorePair(app, page, "toolbar-more-story", /Edit/i);

  // --- Finished run ---
  await page.getByRole("tab", { name: "Runs" }).click({ force: true }).catch(() => {});
  await wait(500);
  const historyRun = page
    .locator("aside, .sidebar-scroll")
    .getByText(/Login Flow/i)
    .first();
  if (await historyRun.isVisible().catch(() => false)) {
    await historyRun.click({ force: true });
  } else {
    await page.getByRole("button", { name: /^Run$/i }).click({ force: true });
  }
  await page.getByRole("button", { name: "Retry run" }).waitFor({ timeout: 60_000 });
  await captureMorePair(app, page, "toolbar-more-run", /View story/i);

  // --- Bulk selection ---
  await page.getByRole("tab", { name: "Stories" }).click({ force: true });
  await wait(500);
  await page.getByRole("button", { name: "Run stories" }).click({ force: true });
  await page.getByRole("heading", { name: "Run stories" }).waitFor({ timeout: 15_000 });
  await captureMorePair(app, page, "toolbar-more-bulk", /Select all|Deselect all/i);

  // --- New schedule ---
  await page.getByRole("tab", { name: "Scheduled" }).click({ force: true });
  await wait(600);
  await page.getByRole("button", { name: "New schedule", exact: true }).last().click({ force: true });
  await page.getByRole("button", { name: /^Create$/i }).waitFor({ timeout: 15_000 });
  await captureMorePair(app, page, "toolbar-more-schedule", /Select all|Deselect all/i);

  await app.close();
  console.log("done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
