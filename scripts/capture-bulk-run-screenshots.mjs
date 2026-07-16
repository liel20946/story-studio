#!/usr/bin/env node
/**
 * Launch Story Studio with mock runs, exercise bulk-run UI + variable runs, capture screenshots.
 * Run from repo root after `npm run build` and `npm run seed:demo`.
 *   STORY_STUDIO_MOCK_RUNS=1 node scripts/capture-bulk-run-screenshots.mjs
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
  process.env.CURSOR_ARTIFACTS_DIR || path.join(root, "artifacts"),
  "bulk-run-screenshots",
);
fs.mkdirSync(outDir, { recursive: true });
for (const f of fs.readdirSync(outDir)) {
  if (f.endsWith(".png")) fs.unlinkSync(path.join(outDir, f));
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

async function openBulkSelection(page) {
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
  await page.getByText("Parallel subagents").waitFor();
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

  await openBulkSelection(page);
  await shot(app, "01-bulk-selection");

  const loginRow = page.getByRole("main").getByText("Login Flow", { exact: true });
  await loginRow.hover();
  await wait(300);
  await shot(app, "02-story-hover-variables-button");

  await page
    .getByRole("button", { name: /Configure variable runs for Login Flow/i })
    .click({ force: true });
  await page.getByText("Variable runs — Login Flow").waitFor();
  await wait(400);
  await shot(app, "03-variables-chat-modal");

  const composer = page.locator(".generate-composer textarea").first();
  await composer.fill("Run as admin and guest with 2 different emails");
  await wait(200);
  await page.getByRole("button", { name: /^Generate$/i }).click({ force: true });
  await page.getByRole("button", { name: /^Save for bulk$/i }).waitFor({ timeout: 15_000 });
  await wait(400);
  await shot(app, "04-variables-review");

  await page.getByRole("button", { name: /^Save for bulk$/i }).click({ force: true });
  await page.getByText("2 runs").waitFor();
  await wait(400);
  await shot(app, "05-bulk-with-saved-variable-runs");

  await page.locator("#bulk-max-parallel").selectOption("2");
  await page.getByPlaceholder(/stop on first failure/i).fill("stop on first failure");
  await page.getByRole("button", { name: /^Select all$/i }).click({ force: true });
  await page.getByRole("button", { name: /^Run 5$/i }).waitFor();
  await shot(app, "06-bulk-run-config");

  await page.getByRole("button", { name: /^Run 5$/i }).click({ force: true });
  await page.getByText(/queued|running/i).first().waitFor();
  await wait(250);
  await shot(app, "07-bulk-run-running");

  await page.getByText("Passed").first().waitFor({ timeout: 15_000 });
  await wait(500);
  await page.getByRole("button", { name: /^Stop$/i }).click({ force: true });
  await page.getByRole("button", { name: /^Resume$/i }).waitFor();
  await wait(500);
  await shot(app, "08-bulk-run-stopped-by-user");

  await page.getByRole("button", { name: /^Resume$/i }).click({ force: true });
  await wait(900);
  await shot(app, "09-bulk-run-resumed");

  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    const condition = await page
      .getByText(/Stopped by condition/i)
      .isVisible()
      .catch(() => false);
    const resume = await page
      .getByRole("button", { name: /^Resume$/i })
      .isVisible()
      .catch(() => false);
    const running = await page
      .getByText(/Running \d+ stories/i)
      .isVisible()
      .catch(() => false);
    const runMoreEnabled = await page
      .getByRole("button", { name: /Run more/i })
      .isEnabled()
      .catch(() => false);
    if (condition || (!running && (resume || runMoreEnabled))) break;
    await wait(400);
  }
  await wait(1000);
  await shot(app, "10-bulk-run-final");

  await app.close();
  console.log("done", outDir);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
