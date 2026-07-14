#!/usr/bin/env node
/**
 * Launch Story Studio with mock runs, exercise bulk-run UI, capture screenshots.
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

async function shot(page, name) {
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
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
  page.setDefaultTimeout(20_000);
  await page.waitForLoadState("domcontentloaded");
  await wait(3000);

  await page.evaluate(() => {
    try {
      sessionStorage.removeItem("story-studio:bulk-session");
      sessionStorage.removeItem("story-studio:bulk-launched");
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

  await page.getByText("Parallel subagents").waitFor();
  await page.locator("#bulk-max-parallel").selectOption("2");
  await page.getByPlaceholder(/stop on first failure/i).fill("stop on first failure");
  await page.getByRole("button", { name: /^Select all$/i }).click({ force: true });
  await page.getByRole("button", { name: /^Run 4$/i }).waitFor();
  await shot(page, "01-bulk-run-config");

  await page.getByRole("button", { name: /^Run 4$/i }).click({ force: true });
  await page.getByText(/queued|running/i).first().waitFor();
  await wait(200);
  await shot(page, "02-bulk-run-running");

  // Let the first wave finish so the stopped view shows Finished + Not run yet.
  await page.getByText("Passed").first().waitFor({ timeout: 10_000 });
  await wait(400);
  // Prefer stopping while stories are still queued/not started.
  const stopBtn = page.getByRole("button", { name: /^Stop$/i });
  if (await stopBtn.isVisible().catch(() => false)) {
    await stopBtn.click({ force: true });
  }
  await page.getByRole("button", { name: /^Resume$/i }).waitFor({ timeout: 10_000 });
  await page.getByText("Not run yet").waitFor({ timeout: 5_000 }).catch(() => {});
  await wait(400);
  await shot(page, "03-bulk-run-stopped-resume");

  await page.getByRole("button", { name: /^Resume$/i }).click({ force: true });
  await wait(800);
  await shot(page, "04-bulk-run-resumed");

  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    const running = await page.getByText(/Running \d+ stories/i).isVisible().catch(() => false);
    const resume = await page.getByRole("button", { name: /^Resume$/i }).isVisible().catch(() => false);
    const runMoreEnabled = await page.getByRole("button", { name: /Run more/i }).isEnabled().catch(() => false);
    if ((!running && runMoreEnabled) || resume) break;
    await wait(350);
  }
  await wait(500);
  await shot(page, "05-bulk-run-final");

  await app.close();
  console.log("done", outDir);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
