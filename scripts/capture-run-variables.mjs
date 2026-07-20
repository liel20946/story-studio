#!/usr/bin/env node
/**
 * Capture a clear Run View screenshot focused on the Variables section.
 *   STORY_STUDIO_MOCK_RUNS=1 xvfb-run -a node scripts/capture-run-variables.mjs
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

  // Confirm Variables is in the DOM and highlight it.
  const found = await page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll(".section-label"));
    const varsLabel = labels.find((el) => el.textContent?.trim() === "Variables");
    const section = varsLabel?.closest(".codex-section");
    if (!(section instanceof HTMLElement)) return false;
    section.style.outline = "2px solid #3b82f6";
    section.style.outlineOffset = "6px";
    section.style.borderRadius = "8px";
    section.scrollIntoView({ block: "nearest" });
    return true;
  });
  if (!found) throw new Error("Variables section not found in run view");
  await wait(250);
  await shot(app, "05-run-view-variables-highlighted");

  // Cropped close-up of the right rail card only.
  const railBox = await page.locator(".detail-rail--card").boundingBox();
  if (railBox) {
    const file = path.join(outDir, "06-run-view-variables-closeup.png");
    await page.screenshot({
      path: file,
      clip: {
        x: Math.max(0, railBox.x - 8),
        y: Math.max(0, railBox.y - 8),
        width: Math.min(railBox.width + 16, 500),
        height: Math.min(railBox.height + 16, 700),
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
