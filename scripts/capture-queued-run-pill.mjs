#!/usr/bin/env node
/**
 * Capture Queued state pills for bulk + overlapping single runs.
 *   STORY_STUDIO_MOCK_RUNS=1 xvfb-run -a node scripts/capture-queued-run-pill.mjs
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
      STORY_STUDIO_MOCK_RUN_MS: "5000",
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

  await page.evaluate(() => {
    try {
      sessionStorage.removeItem("story-studio:bulk-session");
      sessionStorage.removeItem("story-studio:bulk-launched");
      sessionStorage.removeItem("story-studio:bulk-variable-plans");
    } catch {
      /* ignore */
    }
  });

  // --- Bulk: one Running + others Queued ---
  await page
    .getByRole("button", { name: "Run stories" })
    .filter({ hasText: "Run stories" })
    .click({ force: true });
  await wait(1200);
  const runMore = page.getByRole("button", { name: /Run more/i });
  if (await runMore.isVisible().catch(() => false)) {
    await runMore.click({ force: true });
    await wait(600);
  }
  await page.getByText("Stop condition").waitFor();
  await page.getByRole("button", { name: /^Select all$/i }).click({ force: true });
  await wait(300);
  const runBtn = page.getByRole("button", { name: /^Run \d+$/i });
  await runBtn.waitFor();
  await runBtn.click({ force: true });
  await page.getByText("Queued").first().waitFor({ timeout: 10_000 });
  await wait(200);
  await shot(app, "01-bulk-queued-pills");

  // Open a queued row if clickable once it has a run id… pending rows aren't
  // clickable; open the running one then wait — or open Runs tab for pills.
  await page.getByRole("tab", { name: "Runs" }).click({ force: true });
  await wait(500);
  await shot(app, "02-sidebar-queued-pill");

  // Open a still-queued story from the Runs sidebar (prefer Checkout — last in queue).
  const queuedRow = page
    .locator('[data-sidebar] .group\\/row, aside .group\\/row, .group\\/row')
    .filter({ hasText: /Checkout Flow/ })
    .filter({ hasText: "Queued" })
    .first();
  await queuedRow.waitFor({ timeout: 8_000 });
  await queuedRow.click({ force: true });
  await page
    .locator(".run-rail-meta")
    .getByText("Queued", { exact: true })
    .waitFor({ timeout: 8_000 });
  await wait(400);
  await shot(app, "03-run-view-queued");

  await app.close();
  console.log("done", outDir);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
