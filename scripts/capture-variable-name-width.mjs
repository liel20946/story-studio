#!/usr/bin/env node
/**
 * Seed long variable names and capture Run + Story variable rails.
 *   STORY_STUDIO_MOCK_RUNS=1 xvfb-run -a node scripts/capture-variable-name-width.mjs
 */
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const require = createRequire(import.meta.url);
const { _electron: electron } = require("playwright");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outDir = path.join(
  process.env.CURSOR_ARTIFACTS_DIR || "/opt/cursor/artifacts",
  "screenshots",
);
fs.mkdirSync(outDir, { recursive: true });

const LONG_VARS = {
  login_email: "lielaz+999999@wix.com",
  login_password: "secret",
  gift_card_amount: "10",
  recipient_name: "test",
  recipient_email: "lielaz@wix.com",
  gift_message: "test",
};

function userDataDir() {
  return path.join(os.homedir(), ".config/Story Studio");
}

function ensureSettings() {
  const settingsPath = path.join(userDataDir(), "settings.json");
  let current = {};
  try {
    current = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  } catch {
    // fresh
  }
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(
    settingsPath,
    `${JSON.stringify(
      {
        ...current,
        theme: "dark",
        colorThemeDark: "cursor",
        colorThemePaletteDark: null,
        agentProvider: "codex",
      },
      null,
      2,
    )}\n`,
  );
}

function seedStoryAndRun() {
  const base = userDataDir();
  const storiesDir = path.join(base, "stories");
  const runsDir = path.join(base, "runs");
  fs.mkdirSync(storiesDir, { recursive: true });
  fs.mkdirSync(runsDir, { recursive: true });

  const yaml = `stories:
  - id: gift-card-create
    name: Gift Card Create
    url: https://example.com
    mode: recorded
    workflow: |-
      Open https://example.com
      Fill login_email
      Fill login_password
      Create gift card
    assertions: |-
      @3 Verify a gift card was created with the matching details
    variables:
      login_email: ${LONG_VARS.login_email}
      login_password: ${LONG_VARS.login_password}
      gift_card_amount: "${LONG_VARS.gift_card_amount}"
      recipient_name: ${LONG_VARS.recipient_name}
      recipient_email: ${LONG_VARS.recipient_email}
      gift_message: ${LONG_VARS.gift_message}
    created_at: ${Date.now() - 86_400_000}
`;
  fs.writeFileSync(path.join(storiesDir, "example-com.yaml"), yaml);

  const runsJson = path.join(runsDir, "runs.json");
  let existing = [];
  try {
    existing = JSON.parse(fs.readFileSync(runsJson, "utf8"));
  } catch {
    existing = [];
  }
  const prefix = "var-width-";
  existing = existing.filter((r) => !String(r.runId).startsWith(prefix));
  const now = Date.now();
  const runId = `${prefix}${randomUUID().slice(0, 8)}`;
  existing.unshift({
    runId,
    storyName: "example-com--gift-card-create",
    storyTitle: "Gift Card Create",
    status: "passed",
    summary: "All assertions passed",
    assertions: [
      {
        text: "Verify a gift card was created with the matching details",
        passed: true,
      },
    ],
    startedAt: now - 30_000,
    finishedAt: now - 10_000,
    agentProvider: "codex",
    agentModel: "gpt-5.6-terra",
    variableOverrides: { ...LONG_VARS },
    events: [],
  });
  fs.writeFileSync(runsJson, `${JSON.stringify(existing, null, 2)}\n`);
  return { runId, storyName: "example-com--gift-card-create" };
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

async function shotRailCloseup(page, name) {
  const railBox = await page.locator(".detail-rail--card").first().boundingBox();
  if (!railBox) throw new Error("detail rail not found");
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({
    path: file,
    clip: {
      x: Math.max(0, railBox.x - 8),
      y: Math.max(0, railBox.y - 8),
      width: Math.min(railBox.width + 16, 520),
      height: Math.min(railBox.height + 16, 720),
    },
  });
  console.log("wrote", file);
}

async function main() {
  ensureSettings();
  const { runId } = seedStoryAndRun();

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

  // Run view
  await page.getByRole("tab", { name: "Runs" }).click({ force: true });
  await wait(700);
  await page
    .locator(".group\\/row")
    .filter({ hasText: "Gift Card Create" })
    .first()
    .click({ force: true });
  await page.getByText("login_password", { exact: true }).waitFor({ timeout: 15_000 });
  await wait(500);
  await shot(app, "07-run-view-variable-names");
  await shotRailCloseup(page, "08-run-view-variable-names-closeup");

  // Story view
  await page.getByRole("tab", { name: "Stories" }).click({ force: true });
  await wait(500);
  await page.getByText("Gift Card Create", { exact: true }).first().click({ force: true });
  await page.getByText("login_password", { exact: true }).waitFor({ timeout: 15_000 });
  await wait(500);
  await shot(app, "09-story-view-variable-names");
  await shotRailCloseup(page, "10-story-view-variable-names-closeup");

  console.log("seeded run", runId);
  await app.close();
  console.log("done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
