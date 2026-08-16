#!/usr/bin/env node
/**
 * Capture toolbar More + primary CTA cleanup:
 *  1) Story view — More menu closed (Run primary)
 *  2) Story view — More menu open
 *  3) Finished run — More + Retry
 *  4) Finished run — More menu open
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

  await page.getByText("Login Flow", { exact: true }).first().click({ force: true });
  await page.getByRole("button", { name: "More actions" }).waitFor({ timeout: 15_000 });
  await page.getByRole("button", { name: /^Run$/i }).waitFor({ timeout: 5_000 });
  await wait(400);
  await shot(app, "toolbar-more-story-closed");

  await page.getByRole("button", { name: "More actions" }).click({ force: true });
  await page.getByRole("menuitem", { name: /Edit/i }).waitFor({ timeout: 5_000 });
  await wait(250);
  await shot(app, "toolbar-more-story-open");

  // Dismiss menu, then open a finished history run via Retry path if available,
  // otherwise navigate through sidebar history under the story.
  await page.keyboard.press("Escape");
  await wait(200);

  // Prefer an existing finished run under Login Flow in the sidebar.
  const historyRun = page
    .locator('[data-sidebar], aside, .sidebar-scroll')
    .getByText(/ago|passed|failed|cancelled/i)
    .first();
  if (await historyRun.isVisible().catch(() => false)) {
    await historyRun.click({ force: true });
  } else {
    // Start a mock run and wait for finish so Retry appears.
    await page.getByRole("button", { name: /^Run$/i }).click({ force: true });
    await page.getByRole("button", { name: "Retry run" }).waitFor({ timeout: 60_000 });
  }

  await page.getByRole("button", { name: "Retry run" }).waitFor({ timeout: 60_000 });
  await page.getByRole("button", { name: "More actions" }).waitFor({ timeout: 15_000 });
  await wait(400);
  await shot(app, "toolbar-more-run-closed");

  await page.getByRole("button", { name: "More actions" }).click({ force: true });
  await page.getByRole("menuitem", { name: /View story/i }).waitFor({ timeout: 5_000 });
  await wait(250);
  await shot(app, "toolbar-more-run-open");

  await app.close();
  console.log("done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
