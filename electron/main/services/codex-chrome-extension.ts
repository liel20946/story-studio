import { existsSync } from "fs";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

/** Official OpenAI Codex Chrome extension ID (Chrome Web Store). */
export const CODEX_CHROME_EXTENSION_ID = "hehggadaopoacecdllhhajmbjkdcmajg";

export const CODEX_CHROME_EXTENSION_STORE_URL =
  `https://chromewebstore.google.com/detail/codex/${CODEX_CHROME_EXTENSION_ID}`;

/**
 * Codex `-c` overrides for Chrome-extension browser mode.
 *
 * Do NOT pair these with `--ignore-user-config`: that flag empties
 * `~/.codex/config.toml`, which drops `chrome@openai-bundled`, `node_repl`, and
 * `BROWSER_USE_AVAILABLE_BACKENDS` — leaving `@Chrome` unavailable even when the
 * extension is installed and CLI Chrome works interactively.
 *
 * We still pin `multi_agent=false` so a user's global multi-agent setting cannot
 * fan one story into parallel agents with duplicate side effects.
 */
export function buildCodexChromeConfigArgs(): string[] {
  return [
    "-c",
    "features.multi_agent=false",
    "-c",
    "features.browser_use_external=true",
    "-c",
    'plugins."chrome@openai-bundled".enabled=true',
  ];
}

export interface CodexChromeExtensionStatus {
  installed: boolean;
  /** Profile folder name when found (e.g. Default, Profile 1). */
  profile?: string;
  message: string;
}

function chromeUserDataRoots(): string[] {
  const home = os.homedir();
  if (process.platform === "darwin") {
    return [
      path.join(home, "Library", "Application Support", "Google", "Chrome"),
      path.join(home, "Library", "Application Support", "Chromium"),
    ];
  }
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local");
    return [
      path.join(local, "Google", "Chrome", "User Data"),
      path.join(local, "Chromium", "User Data"),
    ];
  }
  return [
    path.join(home, ".config", "google-chrome"),
    path.join(home, ".config", "chromium"),
  ];
}

function looksLikeProfileDir(name: string): boolean {
  return name === "Default" || /^Profile \d+$/i.test(name);
}

/**
 * Detect whether the Codex Chrome extension is installed in any local Chrome
 * profile. No tokens — presence of the extension directory is enough.
 * Story Studio still needs the user's ~/.codex Chrome plugin / node_repl config
 * for @Chrome (loaded when Chrome mode does not pass --ignore-user-config).
 */
export async function probeCodexChromeExtension(): Promise<CodexChromeExtensionStatus> {
  for (const root of chromeUserDataRoots()) {
    if (!existsSync(root)) continue;
    let entries: string[];
    try {
      entries = await fs.readdir(root);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!looksLikeProfileDir(entry)) continue;
      const extDir = path.join(
        root,
        entry,
        "Extensions",
        CODEX_CHROME_EXTENSION_ID,
      );
      if (!existsSync(extDir)) continue;
      try {
        const versions = await fs.readdir(extDir);
        if (versions.length === 0) continue;
      } catch {
        continue;
      }
      return {
        installed: true,
        profile: entry,
        message: `Codex Chrome extension found in ${entry}.`,
      };
    }
  }

  return {
    installed: false,
    message:
      "Codex Chrome extension not found. Install it from the Chrome Web Store, then check again.",
  };
}
