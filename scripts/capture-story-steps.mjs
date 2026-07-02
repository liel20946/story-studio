#!/usr/bin/env node
/**
 * Captures full-window screenshots of the workflow-style story steps UI in:
 * 1. Story detail view
 * 2. Generate chat draft preview
 *
 * Prereqs: seed demo data, dev server with CDP (see below).
 *
 *   npm run seed:demo
 *   xvfb-run -a env CDP_PORT=9222 ... electron-vite dev with --remote-debugging-port=9222
 *   node scripts/capture-story-steps.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = "/opt/cursor/artifacts/screenshots";
const repoOutDir = path.join(__dirname, "../.github/pr-screenshots");

const WINDOW_WIDTH = 1440;
const WINDOW_HEIGHT = 900;

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(repoOutDir, { recursive: true });

async function waitForCdp(port, timeoutMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return;
    } catch {
      // keep waiting
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`CDP not ready on port ${port}`);
}

async function resizeAppWindow(page) {
  await page.setViewportSize({ width: WINDOW_WIDTH, height: WINDOW_HEIGHT });

  const client = await page.context().newCDPSession(page);
  await client.send("Emulation.setDeviceMetricsOverride", {
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    deviceScaleFactor: 1,
    mobile: false,
  });

  await page.waitForTimeout(800);
}

async function captureFullApp(page, name) {
  const filePath = path.join(outDir, `${name}.png`);
  const repoPath = path.join(repoOutDir, `${name}.png`);

  // Capture the full renderer viewport (sidebar + main pane + toolbar).
  await page.screenshot({
    path: filePath,
    fullPage: false,
    type: "png",
  });
  fs.copyFileSync(filePath, repoPath);

  console.log(`Saved ${filePath}`);
  return filePath;
}

async function main() {
  const port = process.env.CDP_PORT ?? "9222";
  await waitForCdp(port);

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  const page =
    context.pages().find((p) => p.url().includes("localhost")) ?? context.pages()[0];

  if (!page) {
    throw new Error("No renderer page found");
  }

  await page.bringToFront();
  await resizeAppWindow(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  await resizeAppWindow(page);

  // Story detail — open from run history if needed, then capture steps.
  await page.getByRole("tab", { name: "Stories" }).click();
  await page.waitForTimeout(700);
  await page.getByRole("tab", { name: "Stories" }).click();
  await page.waitForTimeout(300);
  const loginFlow = page
    .locator("aside, [class*='sidebar']")
    .getByText("Login Flow", { exact: true })
    .first();
  await loginFlow.waitFor({ state: "visible", timeout: 20_000 });
  await loginFlow.click();
  await page.waitForTimeout(600);
  const viewStory = page.getByRole("button", { name: "View story" });
  if (await viewStory.isVisible().catch(() => false)) {
    await viewStory.click();
    await page.waitForTimeout(600);
  }
  await page.waitForSelector(".story-steps-workflow-card", { timeout: 20_000 });
  await page.waitForTimeout(600);
  await captureFullApp(page, "story-view-steps-workflow");

  // Generate chat — Gift card draft with steps preview.
  await page.getByRole("tab", { name: "Generate" }).click();
  await page.waitForTimeout(500);
  await page.getByText("Gift card purchase flow", { exact: true }).first().click();
  await page.waitForTimeout(600);
  const showMore = page.getByRole("button", { name: "Show more" });
  if (await showMore.isVisible().catch(() => false)) {
    await showMore.click();
    await page.waitForTimeout(400);
  }
  await page.waitForSelector(".story-steps-workflow-card", { timeout: 20_000 });
  await page.waitForTimeout(600);
  await captureFullApp(page, "generate-chat-draft-steps-workflow");

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
