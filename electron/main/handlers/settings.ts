import * as fs from "fs/promises";
import * as path from "path";
import { ipcMain, app, nativeTheme } from "../electron-api.js";
import { broadcast } from "../broadcast.js";
import type { AppSettings } from "../services/contract-types.js";
import {
  DEFAULT_AGENT_PROVIDER,
  parseAgentProvider,
} from "../services/agent-provider.js";
import { getStoriesDir, getRunsDir, overridePaths } from "../services/paths.js";

function parseTheme(
  value: unknown,
  fallback: AppSettings["theme"],
): AppSettings["theme"] {
  if (value === "system" || value === "light" || value === "dark") {
    return value;
  }
  return fallback;
}

// Defaults for the user-facing settings (kept in one place so load + set agree).
const DEFAULT_THEME: AppSettings["theme"] = "dark";
const DEFAULT_STARTING_URL = "https://example.com";

const SETTINGS_FILE = () =>
  path.join(app.getPath("userData"), "settings.json");

let _settings: AppSettings | null = null;

function toAppSettings(
  parsed: Partial<AppSettings>,
  defaults: AppSettings,
): AppSettings {
  return {
    agentProvider: parseAgentProvider(parsed.agentProvider ?? defaults.agentProvider),
    codexBinaryPath: parsed.codexBinaryPath ?? defaults.codexBinaryPath,
    claudeBinaryPath: parsed.claudeBinaryPath ?? defaults.claudeBinaryPath,
    storiesDir: parsed.storiesDir ?? defaults.storiesDir,
    runsDir: parsed.runsDir ?? defaults.runsDir,
    theme: parseTheme(parsed.theme, defaults.theme),
    startingUrl: parsed.startingUrl ?? defaults.startingUrl,
    runHook: parsed.runHook ?? defaults.runHook,
  };
}

async function loadSettings(): Promise<AppSettings> {
  if (_settings) return _settings;
  const storiesDir = getStoriesDir();
  const runsDir = getRunsDir();
  const defaults: AppSettings = {
    agentProvider: DEFAULT_AGENT_PROVIDER,
    codexBinaryPath: null,
    claudeBinaryPath: null,
    storiesDir,
    runsDir,
    theme: DEFAULT_THEME,
    startingUrl: DEFAULT_STARTING_URL,
    runHook: "",
  };
  try {
    const data = await fs.readFile(SETTINGS_FILE(), "utf-8");
    const parsed = JSON.parse(data) as Partial<AppSettings> & {
      appearance?: unknown;
    };
    _settings = toAppSettings(parsed, defaults);

    // Drop legacy appearance keys from disk on next read if they were present.
    if ("appearance" in parsed) {
      await persistSettings(_settings);
    }
  } catch {
    _settings = defaults;
  }
  return _settings;
}

async function persistSettings(s: AppSettings): Promise<void> {
  await fs.writeFile(SETTINGS_FILE(), JSON.stringify(s, null, 2), "utf-8");
}

/** Synchronous accessor for other modules (after loadSettings has been called). */
export function getSettingsValue(): AppSettings {
  if (!_settings) {
    // Return safe defaults before first async load completes
    return {
      agentProvider: DEFAULT_AGENT_PROVIDER,
      codexBinaryPath: null,
      claudeBinaryPath: null,
      storiesDir: getStoriesDir(),
      runsDir: getRunsDir(),
      theme: DEFAULT_THEME,
      startingUrl: DEFAULT_STARTING_URL,
      runHook: "",
    };
  }
  return _settings;
}

export function registerSettingsHandlers(): void {
  ipcMain.handle("settings:get", async () => {
    return loadSettings();
  });

  ipcMain.handle("settings:set", async (_event, params: unknown) => {
    if (typeof params !== "object" || params === null) {
      throw new Error("settings:set requires an object");
    }
    const p = params as Record<string, unknown>;
    const current = await loadSettings();

    // Settable fields (dirs are computed from userData, never set here).
    if ("agentProvider" in p) {
      const val = p["agentProvider"];
      if (val !== "codex" && val !== "claude-code") {
        throw new Error("settings:set agentProvider must be 'codex' | 'claude-code'");
      }
      current.agentProvider = val;
    }

    if ("codexBinaryPath" in p) {
      const val = p["codexBinaryPath"];
      if (val !== null && typeof val !== "string") {
        throw new Error("settings:set codexBinaryPath must be string | null");
      }
      current.codexBinaryPath = val as string | null;
    }

    if ("claudeBinaryPath" in p) {
      const val = p["claudeBinaryPath"];
      if (val !== null && typeof val !== "string") {
        throw new Error("settings:set claudeBinaryPath must be string | null");
      }
      current.claudeBinaryPath = val as string | null;
    }

    if ("theme" in p) {
      const val = p["theme"];
      const theme = parseTheme(val, current.theme);
      if (val !== theme) {
        throw new Error("settings:set theme must be 'system' | 'dark' | 'light'");
      }
      current.theme = theme;
      // Apply immediately so all open windows update without a restart.
      nativeTheme.themeSource = theme;
    }

    if ("startingUrl" in p) {
      const val = p["startingUrl"];
      if (typeof val !== "string") {
        throw new Error("settings:set startingUrl must be string");
      }
      current.startingUrl = val;
    }

    if ("runHook" in p) {
      const val = p["runHook"];
      if (typeof val !== "string") {
        throw new Error("settings:set runHook must be string");
      }
      current.runHook = val;
    }

    _settings = current;
    await persistSettings(current);
    broadcast("settings:codexBinaryPath-changed", { value: current.codexBinaryPath });
    if ("theme" in p) {
      broadcast("settings:theme-changed", { theme: current.theme });
    }
    console.log("[settings] saved", current);
    return current;
  });
}

/** Call once at startup after initPaths() to load saved settings and apply overrides. */
export async function initSettings(): Promise<AppSettings> {
  const s = await loadSettings();
  const defaultStories = getStoriesDir();
  const defaultRuns = getRunsDir();

  const loadedStories = s.storiesDir;
  const loadedRuns = s.runsDir;

  // Ignore migrated/stale directory overrides that don't exist on this machine.
  const storiesDir =
    loadedStories && loadedStories !== defaultStories
      ? await pathExists(loadedStories)
        ? loadedStories
        : defaultStories
      : defaultStories;
  const runsDir =
    loadedRuns && loadedRuns !== defaultRuns
      ? await pathExists(loadedRuns)
        ? loadedRuns
        : defaultRuns
      : defaultRuns;

  s.storiesDir = storiesDir;
  s.runsDir = runsDir;
  _settings = s;

  overridePaths({ storiesDir, runsDir });
  nativeTheme.themeSource = s.theme;

  if (storiesDir !== loadedStories || runsDir !== loadedRuns) {
    await persistSettings(s);
  }

  return s;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
