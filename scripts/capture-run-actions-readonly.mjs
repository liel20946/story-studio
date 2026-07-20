#!/usr/bin/env node
/**
 * Capture run view Actions list (read-only, no selection highlight).
 *   STORY_STUDIO_MOCK_RUNS=1 xvfb-run -a node scripts/capture-run-actions-readonly.mjs
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

  await page.getByRole("tab", { name: "Runs" }).click({ force: true });
  await wait(800);
  await page
    .locator(".group\\/row")
    .filter({ hasText: "Login Flow" })
    .first()
    .click({ force: true });
  await page.getByRole("button", { name: "Retry run" }).waitFor({ timeout: 15_000 });
  await wait(800);

  // Click a middle action row — should not highlight or change selection.
  const rows = page.locator(".timeline-row");
  await rows.first().waitFor({ timeout: 10_000 });
  const count = await rows.count();
  if (count > 1) {
    await rows.nth(Math.min(2, count - 1)).click({ force: true });
    await wait(300);
  }

  const selectedCount = await page.locator(".timeline-row--selected").count();
  if (selectedCount !== 0) {
    throw new Error(`Expected no selected action rows, found ${selectedCount}`);
  }

  await shot(app, "01-run-actions-no-selection");

  const actionsBox = await page.locator(".run-actions-card").boundingBox();
  if (actionsBox) {
    const file = path.join(outDir, "02-run-actions-closeup.png");
    await page.screenshot({
      path: file,
      clip: {
        x: Math.max(0, actionsBox.x - 8),
        y: Math.max(0, actionsBox.y - 8),
        width: Math.min(actionsBox.width + 16, 700),
        height: Math.min(actionsBox.height + 16, 800),
      },
    });
    console.log("wrote", file);
  }

  await app.close();
  console.log("done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
