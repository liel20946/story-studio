#!/usr/bin/env node
/**
 * Verify bundled Playwright MCP + Chromium, then capture Setup + a story run.
 *   STORY_STUDIO_MOCK_RUNS=1 xvfb-run -a node scripts/capture-bundled-playwright.mjs
 */
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
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
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library/Application Support/Story Studio");
  }
  return path.join(os.homedir(), ".config/Story Studio");
}

function electronExec() {
  const electronPath = path.dirname(require.resolve("electron"));
  const relative = fs.readFileSync(path.join(electronPath, "path.txt"), "utf8").trim();
  return path.join(electronPath, "dist", relative);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function ensureSettings() {
  const settingsPath = path.join(userDataDir(), "settings.json");
  let current = {};
  try {
    current = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  } catch {
    // fresh
  }
  const next = {
    ...current,
    theme: "dark",
    colorThemeDark: "cursor",
    colorThemePaletteDark: null,
    browserMode: "private",
    agentProvider: "codex",
  };
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, `${JSON.stringify(next, null, 2)}\n`);
}

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
  return file;
}

function sendRpc(child, message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

async function browseWithBundledMcp() {
  const mcpCli = path.join(
    root,
    "resources/playwright-mcp/node_modules/@playwright/mcp/cli.js",
  );
  const browsersDir = path.join(root, "resources/ms-playwright");
  if (!fs.existsSync(mcpCli)) {
    throw new Error(`Bundled MCP CLI missing: ${mcpCli}`);
  }
  if (!fs.existsSync(browsersDir)) {
    throw new Error(`Bundled Chromium missing: ${browsersDir}`);
  }

  const outputDir = path.join(outDir, "mcp-browse");
  fs.mkdirSync(outputDir, { recursive: true });

  const child = spawn(
    electronExec(),
    [mcpCli, "--headless", "--isolated", "--viewport-size=1920,1080", "--output-dir", outputDir],
    {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        PLAYWRIGHT_BROWSERS_PATH: browsersDir,
        HOME: os.homedir(),
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  let stdout = "";
  let stderr = "";
  const pending = new Map();
  let nextId = 1;

  const call = (method, params) => {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`MCP ${method} timed out`));
      }, 45_000);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      sendRpc(child, { jsonrpc: "2.0", id, method, params });
    });
  };

  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
    let newline;
    while ((newline = stdout.indexOf("\n")) !== -1) {
      const line = stdout.slice(0, newline).trim();
      stdout = stdout.slice(newline + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      const waiter = pending.get(message.id);
      if (!waiter) continue;
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message ?? "MCP error"));
      else waiter.resolve(message.result);
    }
  });

  try {
    await call("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "story-studio-bundle-verify", version: "1.0.0" },
    });
    sendRpc(child, { jsonrpc: "2.0", method: "notifications/initialized" });
    await call("tools/list", {});
    await call("tools/call", {
      name: "browser_navigate",
      arguments: { url: "https://example.com" },
    });
    await call("tools/call", {
      name: "browser_take_screenshot",
      arguments: { filename: path.join(outputDir, "example-com.png") },
    });
  } finally {
    child.kill("SIGKILL");
  }

  const candidates = [
    path.join(outputDir, "example-com.png"),
    path.join(root, "example-com.png"),
    ...fs.readdirSync(outputDir).map((name) => path.join(outputDir, name)),
  ];
  const screenshot = candidates.find((file) => /\.(png|jpe?g)$/i.test(file) && fs.existsSync(file));
  if (!screenshot) {
    throw new Error(`MCP browse produced no screenshot. stderr: ${stderr.slice(0, 800)}`);
  }
  const dest = path.join(outDir, "03-mcp-browsed-example-com.png");
  const src = path.isAbsolute(screenshot) ? screenshot : path.join(outputDir, screenshot);
  fs.copyFileSync(src, dest);
  console.log("wrote", dest);
  return dest;
}

async function main() {
  ensureSettings();
  console.log("browsing example.com via bundled Playwright MCP…");
  await browseWithBundledMcp();

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
  page.setDefaultTimeout(60_000);
  await page.waitForLoadState("domcontentloaded");
  await wait(4000);

  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (!w) return;
    w.setMinimumSize(1200, 800);
    w.setSize(1440, 900);
    w.center();
    w.show();
  });
  await wait(800);

  await page.keyboard.press("Control+Comma");
  await wait(900);
  await page.getByRole("button", { name: "Setup", exact: true }).click({ force: true });
  await wait(700);
  const refresh = page.getByRole("button", { name: "Refresh" });
  if (await refresh.isVisible().catch(() => false)) {
    await refresh.click({ force: true });
  }
  await page.getByText("Playwright MCP", { exact: false }).waitFor({ timeout: 60_000 });
  await wait(8000);
  await shot(app, "01-settings-setup-bundled-playwright");

  await page.keyboard.press("Escape");
  await wait(500);
  const login = page.getByText("Login Flow", { exact: false }).first();
  if (await login.isVisible().catch(() => false)) {
    await login.click({ force: true });
    await wait(800);
    const runBtn = page.getByRole("button", { name: /^Run$/ }).first();
    if (await runBtn.isVisible().catch(() => false)) {
      await runBtn.click({ force: true });
      await wait(2500);
    }
    await shot(app, "02-story-run-working");
  } else {
    await shot(app, "02-stories-home");
  }

  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
