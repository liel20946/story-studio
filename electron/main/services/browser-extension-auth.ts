import * as fs from "fs/promises";
import * as path from "path";
import { app, safeStorage } from "../electron-api.js";

const TOKEN_FILE = () =>
  path.join(app.getPath("userData"), "playwright-extension-token");

function normalizeTokenInput(value: string): string {
  let token = value.trim();
  const assignment = token.match(
    /^(?:export\s+)?PLAYWRIGHT_MCP_EXTENSION_TOKEN\s*=\s*(.+)$/s,
  );
  if (assignment) token = assignment[1].trim();
  if (
    token.length >= 2 &&
    ((token.startsWith('"') && token.endsWith('"')) ||
      (token.startsWith("'") && token.endsWith("'")))
  ) {
    token = token.slice(1, -1).trim();
  }
  return token;
}

export async function hasBrowserExtensionToken(): Promise<boolean> {
  return (await readBrowserExtensionToken()) !== null;
}

export async function readBrowserExtensionToken(): Promise<string | null> {
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    const encrypted = await fs.readFile(TOKEN_FILE());
    const token = safeStorage.decryptString(encrypted).trim();
    return token || null;
  } catch {
    return null;
  }
}

export async function saveBrowserExtensionToken(token: string): Promise<void> {
  const normalized = normalizeTokenInput(token);
  if (!normalized) {
    throw new Error("The Playwright extension token cannot be empty.");
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      "Secure credential storage is unavailable. Unlock your macOS keychain and try again.",
    );
  }
  await fs.writeFile(TOKEN_FILE(), safeStorage.encryptString(normalized), {
    mode: 0o600,
  });
}

export async function clearBrowserExtensionToken(): Promise<void> {
  await fs.rm(TOKEN_FILE(), { force: true });
}
