#!/usr/bin/env node
/**
 * Capture bulk variable-runs UX including file/folder attachments + Stop all.
 * STORY_STUDIO_MOCK_RUNS=1 xvfb-run -a node scripts/capture-bulk-variables-flow.mjs
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

const fixturesDir = path.join(outDir, "bulk-var-fixtures");
fs.mkdirSync(fixturesDir, { recursive: true });
const htmlA = path.join(fixturesDir, "welcome.html");
const htmlB = path.join(fixturesDir, "promo.html");
fs.writeFileSync(
  htmlA,
  "<html><body><h1>Welcome email</h1><p>Hello from fixture A</p></body></html>\n",
);
fs.writeFileSync(
  htmlB,
  "<html><body><h1>Promo banner</h1><p>Hello from fixture B</p></body></html>\n",
);

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
      STORY_STUDIO_MOCK_ATTACHMENTS: `${htmlA}:${htmlB}:${fixturesDir}`,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
    },
    timeout: 120_000,
  });

  const page = await app.firstWindow();
  page.setDefaultTimeout(25_000);
  await page.waitForLoadState("domcontentloaded");
  await wait(3000);

  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (!w) return;
    w.setMinimumSize(1200, 800);
    w.setSize(1440, 900);
    w.center();
    w.show();
  });
  await wait(500);

  await page.evaluate(() => {
    try {
      sessionStorage.removeItem("story-studio:bulk-session");
      sessionStorage.removeItem("story-studio:bulk-launched");
      sessionStorage.removeItem("story-studio:bulk-variable-plans");
    } catch {
      /* ignore */
    }
  });

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
  await shot(app, "01-bulk-selection");

  await page.evaluate(() => {
    const btn = document.querySelector(
      'button[aria-label="Configure variable runs for Login Flow"]',
    );
    if (btn instanceof HTMLElement) {
      btn.style.opacity = "1";
      btn.style.outline = "2px solid #e85d4c";
      btn.style.outlineOffset = "2px";
      const row = btn.closest(".group\\/row") || btn.parentElement;
      if (row instanceof HTMLElement) {
        row.style.background = "rgba(255,255,255,0.06)";
      }
    }
  });
  await wait(200);
  await shot(app, "02-story-hover-variables-button");

  await page
    .getByRole("button", { name: /Configure variable runs for Login Flow/i })
    .click({ force: true });
  await page.getByText(/Variable runs[:\s].*Login Flow/i).waitFor();
  await wait(400);
  await shot(app, "03-variables-chat-modal");

  await page.getByRole("button", { name: /Attach files or folder/i }).click({ force: true });
  await page.getByRole("menuitem", { name: /Attach files/i }).click({ force: true });
  await page.getByText("welcome.html").waitFor({ timeout: 5_000 });
  await wait(300);
  await shot(app, "03a-variables-chat-with-attachments");

  await page.getByRole("button", { name: /Attach files or folder/i }).click({ force: true });
  await page.getByRole("menuitem", { name: /Attach folder/i }).click({ force: true });
  await page.getByText("bulk-var-fixtures").waitFor({ timeout: 5_000 });
  await wait(300);
  await shot(app, "03a2-variables-chat-with-folder");

  // Open the plus menu once more so reviewers can see File/Folder options.
  await page.getByRole("button", { name: /Attach files or folder/i }).click({ force: true });
  await page.getByRole("menuitem", { name: /Attach files/i }).waitFor();
  await wait(200);
  await shot(app, "03a3-attach-plus-menu");
  await page.keyboard.press("Escape");
  await wait(150);

  const composer = page.locator(".generate-composer textarea").first();
  await composer.fill(
    "Create one run per attached HTML file and use each file as the paste body",
  );
  await wait(250);
  await shot(app, "03b-variables-chat-filled");
  await page.getByRole("button", { name: /^Send$/i }).click({ force: true });
  await page
    .getByText(/Talking with the agent|Generating variable/i)
    .waitFor({ timeout: 5_000 })
    .catch(() => {});
  await wait(200);
  await shot(app, "03c-variables-generating");
  await page.getByRole("button", { name: /^Save for bulk$/i }).waitFor({ timeout: 15_000 });
  await wait(400);
  await shot(app, "04-variables-review");

  await page.getByRole("button", { name: /^Save for bulk$/i }).click({ force: true });
  await page.getByText(/\d+ runs?/i).waitFor();
  await wait(400);
  await shot(app, "05-bulk-with-saved-variable-runs");

  // Start a multi-story bulk so Stop all is visible.
  await page.getByRole("button", { name: /^Select all$/i }).click({ force: true });
  await wait(300);
  const runBtn = page.getByRole("button", { name: /^Run \d+$/i });
  await runBtn.waitFor();
  await runBtn.click({ force: true });
  await page.getByText(/Running \d+ stories/i).waitFor({ timeout: 15_000 });
  await wait(400);
  await shot(app, "06-bulk-running-stop-all");

  const stopAll = page.getByRole("button", { name: /Stop all/i });
  await stopAll.waitFor({ timeout: 10_000 });
  await stopAll.click({ force: true });
  await page.getByText(/Stopped/i).first().waitFor({ timeout: 15_000 });
  await wait(500);
  await shot(app, "07-bulk-stopped-all");

  await app.close();
  console.log("done", outDir);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
