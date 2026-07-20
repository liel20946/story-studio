#!/usr/bin/env node
/**
 * Capture story view/edit with all assertions removed.
 *   STORY_STUDIO_MOCK_RUNS=1 xvfb-run -a node scripts/capture-empty-assertions.mjs
 */
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
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

function userDataDir() {
  return path.join(os.homedir(), ".config/Story Studio");
}

function seedStory() {
  const storiesDir = path.join(userDataDir(), "stories");
  fs.mkdirSync(storiesDir, { recursive: true });
  const yaml = `stories:
  - id: empty-assertions-demo
    name: Empty Assertions Demo
    url: https://example.com/dashboard
    mode: recorded
    workflow: |-
      Navigate to https://example.com/dashboard
      Click Create
      Fill store_name
    assertions: |-
      @1 Verify the page loads successfully
      @3 Verify the expected page state is visible
    variables:
      store_name: demo-store
    created_at: ${Date.now() - 86_400_000}
`;
  fs.writeFileSync(path.join(storiesDir, "example-com.yaml"), yaml);
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

async function main() {
  seedStory();

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

  await page.getByRole("tab", { name: "Stories" }).click({ force: true });
  await wait(500);
  await page.getByText("Empty Assertions Demo").first().click({ force: true });
  await page.getByRole("button", { name: /^Edit$/i }).waitFor({ timeout: 15_000 });
  await wait(500);

  await shot(app, "01-story-with-default-assertions");

  await page.getByRole("button", { name: /^Edit$/i }).click({ force: true });
  await page.getByRole("button", { name: /^Save$/i }).waitFor();
  await wait(400);

  const assertionInputs = page.getByRole("textbox", { name: /^Assertion / });
  await assertionInputs.first().waitFor({ timeout: 10_000 });
  let count = await assertionInputs.count();
  while (count > 1) {
    const last = assertionInputs.nth(count - 1);
    await last.click({ force: true });
    await last.fill("");
    await last.press("Backspace");
    await wait(200);
    count = await assertionInputs.count();
  }
  await assertionInputs.first().fill("");
  await wait(300);

  await shot(app, "02-story-edit-cleared-assertions");

  await page.getByRole("button", { name: /^Save$/i }).click({ force: true });
  await page.getByRole("button", { name: /^Edit$/i }).waitFor({ timeout: 15_000 });
  await wait(800);

  // Assertions section should be gone in read-only view when empty.
  const assertionHeading = page.getByText("Assertions", { exact: true });
  const visibleAssertions = await assertionHeading.count();
  if (visibleAssertions !== 0) {
    throw new Error(
      `Expected no Assertions section after save, found ${visibleAssertions}`,
    );
  }

  await shot(app, "03-story-saved-without-assertions");

  // Re-open edit and confirm defaults did not return.
  await page.getByRole("button", { name: /^Edit$/i }).click({ force: true });
  await page.getByRole("button", { name: /^Save$/i }).waitFor();
  await wait(400);
  const afterInputs = page.getByRole("textbox", { name: /^Assertion / });
  await afterInputs.first().waitFor({ timeout: 10_000 });
  const afterCount = await afterInputs.count();
  const afterValue = await afterInputs.first().inputValue();
  if (afterCount !== 1 || afterValue.trim() !== "") {
    throw new Error(
      `Defaults returned after save: count=${afterCount} value=${JSON.stringify(afterValue)}`,
    );
  }

  await shot(app, "04-story-reedit-still-empty");

  await app.close();
  console.log("done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
