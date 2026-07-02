#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outDir = "/opt/cursor/artifacts/screenshots";
const importYaml = path.join(outDir, "sample-import.yaml");

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  importYaml,
  `stories:
  - id: checkout-flow
    name: Checkout Flow
    url: https://example.com/checkout
    mode: recorded
    workflow: |-
      Open https://example.com/checkout
      Click Add to cart
      Click Checkout
    assertions: |-
      @2 Verify order summary is visible
    created_at: ${Date.now()}
`,
  "utf8",
);

async function waitForCdp(port, timeoutMs = 90_000) {
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

async function captureWindow(page, name) {
  const filePath = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: false });
  console.log(`Saved ${filePath}`);
  return filePath;
}

async function openSettingsData(page) {
  await page.keyboard.press("Control+Comma");
  await page.waitForTimeout(800);
  await page.getByText("Data", { exact: true }).click();
  await page.waitForTimeout(500);
}

async function main() {
  const port = process.env.CDP_PORT ?? "9222";
  const onlyImport = process.argv.includes("--import-only");
  await waitForCdp(port);

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  const page =
    context.pages().find((p) => p.url().includes("localhost:5173")) ??
    context.pages()[0];

  if (!page) {
    throw new Error("No renderer page found");
  }

  await page.bringToFront();
  await page.waitForTimeout(500);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  if (!onlyImport) {
    await openSettingsData(page);
    await captureWindow(page, "01-settings-data-panel");

    await page.getByRole("button", { name: "Export…" }).click();
    await page.waitForSelector("text=Export stories", { timeout: 10_000 });
    await page.waitForTimeout(400);
    await captureWindow(page, "02-export-dialog");

    await page.getByRole("button", { name: "Cancel" }).click();
    await page.waitForTimeout(400);
  } else {
    await openSettingsData(page);
  }

  await page.evaluate(
    async ({ yamlPath }) => {
      const preview = await window.electronAPI.invoke("stories:previewImport", {
        paths: [yamlPath],
      });
      window.dispatchEvent(
        new CustomEvent("dev:show-import-dialog", {
          detail: { preview, paths: [yamlPath] },
        }),
      );
    },
    { yamlPath: importYaml },
  );
  await page.waitForSelector("text=Import stories", { timeout: 10_000 });
  await page.waitForTimeout(400);
  await captureWindow(page, "03-import-dialog");

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
