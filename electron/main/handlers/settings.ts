import * as fs from "fs/promises";
import * as path from "path";
import { ipcMain, app, nativeTheme } from "../electron-api.js";
import { broadcast } from "../broadcast.js";
import type { AppSettings } from "../services/contract-types.js";
import {
  DEFAULT_AGENT_PROVIDER,
  parseAgentProvider,
} from "../services/agent-provider.js";
import {
  defaultAgentModelSettings,
  parseAgentModelSettings,
} from "../services/agent-config.js";
import {
  warmAgentCapabilitiesCache,
  normalizeAgentModelSettings,
  isModelAllowed,
  isEffortAllowed,
} from "../services/agent-capabilities.js";
import { getStoriesDir, getRunsDir, overridePaths } from "../services/paths.js";
import { parseColorThemeId } from "../../../src/lib/color-themes.js";
import {
  DEFAULT_COLOR_THEME_CONTRAST,
  parseColorThemeContrast,
  parseColorThemePalette,
} from "../../../src/lib/color-theme-config.js";

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
const DEFAULT_COLOR_THEME = parseColorThemeId(undefined);
const DEFAULT_STARTING_URL = "https://example.com";

const SETTINGS_FILE = () =>
  path.join(app.getPath("userData"), "settings.json");

let _settings: AppSettings | null = null;

function parseColorThemeFields(
  parsed: Partial<AppSettings> & { colorTheme?: unknown },
  defaults: AppSettings,
): Pick<AppSettings, "colorThemeLight" | "colorThemeDark"> {
  const legacy =
    typeof parsed.colorTheme === "string" ? parsed.colorTheme : undefined;
  return {
    colorThemeLight: parseColorThemeId(
      parsed.colorThemeLight ?? legacy,
      defaults.colorThemeLight,
    ),
    colorThemeDark: parseColorThemeId(
      parsed.colorThemeDark ?? legacy,
      defaults.colorThemeDark,
    ),
  };
}

type ParsedSettings = Partial<AppSettings> & {
  colorTheme?: unknown;
};

function toAppSettings(
  parsed: ParsedSettings,
  defaults: AppSettings,
): AppSettings {
  const modelDefaults = normalizeAgentModelSettings(
    parseAgentModelSettings(parsed, defaults),
  );
  const colorThemes = parseColorThemeFields(parsed, defaults);
  return {
    agentProvider: parseAgentProvider(parsed.agentProvider ?? defaults.agentProvider),
    codexBinaryPath: parsed.codexBinaryPath ?? defaults.codexBinaryPath,
    claudeBinaryPath: parsed.claudeBinaryPath ?? defaults.claudeBinaryPath,
    codexModel: modelDefaults.codexModel,
    codexEffort: modelDefaults.codexEffort,
    claudeModel: modelDefaults.claudeModel,
    claudeEffort: modelDefaults.claudeEffort,
    storiesDir: parsed.storiesDir ?? defaults.storiesDir,
    runsDir: parsed.runsDir ?? defaults.runsDir,
    theme: parseTheme(parsed.theme, defaults.theme),
    colorThemeLight: colorThemes.colorThemeLight,
    colorThemeDark: colorThemes.colorThemeDark,
    colorThemePaletteLight:
      parseColorThemePalette(parsed.colorThemePaletteLight) ??
      defaults.colorThemePaletteLight,
    colorThemePaletteDark:
      parseColorThemePalette(parsed.colorThemePaletteDark) ??
      defaults.colorThemePaletteDark,
    colorThemeContrastLight: parseColorThemeContrast(
      parsed.colorThemeContrastLight,
      defaults.colorThemeContrastLight,
    ),
    colorThemeContrastDark: parseColorThemeContrast(
      parsed.colorThemeContrastDark,
      defaults.colorThemeContrastDark,
    ),
    usePointerCursors:
      typeof parsed.usePointerCursors === "boolean"
        ? parsed.usePointerCursors
        : defaults.usePointerCursors,
    codexComputerUse:
      typeof parsed.codexComputerUse === "boolean"
        ? parsed.codexComputerUse
        : defaults.codexComputerUse,
    startingUrl: parsed.startingUrl ?? defaults.startingUrl,
    runHook: parsed.runHook ?? defaults.runHook,
  };
}

async function loadSettings(): Promise<AppSettings> {
  const storiesDir = getStoriesDir();
  const runsDir = getRunsDir();
  const modelDefaults = defaultAgentModelSettings();
  const defaults: AppSettings = {
    agentProvider: DEFAULT_AGENT_PROVIDER,
    codexBinaryPath: null,
    claudeBinaryPath: null,
    codexModel: modelDefaults.codexModel,
    codexEffort: modelDefaults.codexEffort,
    claudeModel: modelDefaults.claudeModel,
    claudeEffort: modelDefaults.claudeEffort,
    storiesDir,
    runsDir,
    theme: DEFAULT_THEME,
    colorThemeLight: DEFAULT_COLOR_THEME,
    colorThemeDark: DEFAULT_COLOR_THEME,
    colorThemePaletteLight: null,
    colorThemePaletteDark: null,
    colorThemeContrastLight: DEFAULT_COLOR_THEME_CONTRAST,
    colorThemeContrastDark: DEFAULT_COLOR_THEME_CONTRAST,
    usePointerCursors: false,
    codexComputerUse: false,
    startingUrl: DEFAULT_STARTING_URL,
    runHook: "",
  };

  if (_settings) {
    _settings = toAppSettings(_settings, defaults);
    return _settings;
  }

  try {
    const data = await fs.readFile(SETTINGS_FILE(), "utf-8");
    const parsed = JSON.parse(data) as Partial<AppSettings> & {
      appearance?: unknown;
      colorTheme?: unknown;
    };
    _settings = toAppSettings(parsed, defaults);

    const needsMigration =
      "appearance" in parsed ||
      "colorTheme" in parsed ||
      !("colorThemeLight" in parsed) ||
      !("colorThemeDark" in parsed) ||
      !("colorThemeContrastLight" in parsed) ||
      !("colorThemeContrastDark" in parsed);
    if (needsMigration) {
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
    const modelDefaults = defaultAgentModelSettings();
    // Return safe defaults before first async load completes
    return {
      agentProvider: DEFAULT_AGENT_PROVIDER,
      codexBinaryPath: null,
      claudeBinaryPath: null,
      codexModel: modelDefaults.codexModel,
      codexEffort: modelDefaults.codexEffort,
      claudeModel: modelDefaults.claudeModel,
      claudeEffort: modelDefaults.claudeEffort,
      storiesDir: getStoriesDir(),
      runsDir: getRunsDir(),
      theme: DEFAULT_THEME,
      colorThemeLight: DEFAULT_COLOR_THEME,
      colorThemeDark: DEFAULT_COLOR_THEME,
      colorThemePaletteLight: null,
      colorThemePaletteDark: null,
      colorThemeContrastLight: DEFAULT_COLOR_THEME_CONTRAST,
      colorThemeContrastDark: DEFAULT_COLOR_THEME_CONTRAST,
      usePointerCursors: false,
      codexComputerUse: false,
      startingUrl: DEFAULT_STARTING_URL,
      runHook: "",
    };
  }
  return _settings;
}

export function registerSettingsHandlers(): void {
  ipcMain.handle("settings:get", async () => {
    const s = await loadSettings();
    const normalized = normalizeAgentModelSettings(s);
    const next = { ...s, ...normalized };
    if (
      normalized.codexModel !== s.codexModel ||
      normalized.codexEffort !== s.codexEffort ||
      normalized.claudeModel !== s.claudeModel ||
      normalized.claudeEffort !== s.claudeEffort
    ) {
      _settings = next;
      await persistSettings(next);
    }
    return { ...next };
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

    if ("codexModel" in p) {
      const val = p["codexModel"];
      if (!isModelAllowed("codex", val)) {
        throw new Error("settings:set codexModel is invalid");
      }
      current.codexModel = val;
    }

    if ("codexEffort" in p) {
      const val = p["codexEffort"];
      if (!isEffortAllowed("codex", current.codexModel, val)) {
        throw new Error("settings:set codexEffort is invalid for the selected model");
      }
      current.codexEffort = val;
    }

    if ("claudeModel" in p) {
      const val = p["claudeModel"];
      if (!isModelAllowed("claude-code", val)) {
        throw new Error("settings:set claudeModel is invalid");
      }
      current.claudeModel = val;
    }

    if ("claudeEffort" in p) {
      const val = p["claudeEffort"];
      if (!isEffortAllowed("claude-code", current.claudeModel, val)) {
        throw new Error("settings:set claudeEffort is invalid for the selected model");
      }
      current.claudeEffort = val;
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

    if ("colorThemeLight" in p) {
      const val = p["colorThemeLight"];
      const colorThemeLight = parseColorThemeId(val, current.colorThemeLight);
      if (val !== colorThemeLight) {
        throw new Error("settings:set colorThemeLight is invalid");
      }
      current.colorThemeLight = colorThemeLight;
    }

    if ("colorThemeDark" in p) {
      const val = p["colorThemeDark"];
      const colorThemeDark = parseColorThemeId(val, current.colorThemeDark);
      if (val !== colorThemeDark) {
        throw new Error("settings:set colorThemeDark is invalid");
      }
      current.colorThemeDark = colorThemeDark;
    }

    if ("colorThemePaletteLight" in p) {
      const val = p["colorThemePaletteLight"];
      if (val !== null && parseColorThemePalette(val) === null) {
        throw new Error("settings:set colorThemePaletteLight is invalid");
      }
      current.colorThemePaletteLight = parseColorThemePalette(val);
    }

    if ("colorThemePaletteDark" in p) {
      const val = p["colorThemePaletteDark"];
      if (val !== null && parseColorThemePalette(val) === null) {
        throw new Error("settings:set colorThemePaletteDark is invalid");
      }
      current.colorThemePaletteDark = parseColorThemePalette(val);
    }

    if ("colorThemeContrastLight" in p) {
      const val = p["colorThemeContrastLight"];
      if (typeof val !== "number" || Number.isNaN(val)) {
        throw new Error("settings:set colorThemeContrastLight must be a number");
      }
      current.colorThemeContrastLight = parseColorThemeContrast(val);
    }

    if ("colorThemeContrastDark" in p) {
      const val = p["colorThemeContrastDark"];
      if (typeof val !== "number" || Number.isNaN(val)) {
        throw new Error("settings:set colorThemeContrastDark must be a number");
      }
      current.colorThemeContrastDark = parseColorThemeContrast(val);
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

    if ("usePointerCursors" in p) {
      const val = p["usePointerCursors"];
      if (typeof val !== "boolean") {
        throw new Error("settings:set usePointerCursors must be boolean");
      }
      current.usePointerCursors = val;
    }

    if ("codexComputerUse" in p) {
      const val = p["codexComputerUse"];
      if (typeof val !== "boolean") {
        throw new Error("settings:set codexComputerUse must be boolean");
      }
      current.codexComputerUse = val;
    }

    _settings = current;
    await persistSettings(current);
    broadcast("settings:codexBinaryPath-changed", { value: current.codexBinaryPath });
    if ("theme" in p) {
      broadcast("settings:theme-changed", { theme: current.theme });
    }
    if (
      "colorThemeLight" in p ||
      "colorThemeDark" in p ||
      "colorThemePaletteLight" in p ||
      "colorThemePaletteDark" in p ||
      "colorThemeContrastLight" in p ||
      "colorThemeContrastDark" in p
    ) {
      broadcast("settings:color-theme-changed", {
        colorThemeLight: current.colorThemeLight,
        colorThemeDark: current.colorThemeDark,
        colorThemePaletteLight: current.colorThemePaletteLight,
        colorThemePaletteDark: current.colorThemePaletteDark,
        colorThemeContrastLight: current.colorThemeContrastLight,
        colorThemeContrastDark: current.colorThemeContrastDark,
      });
    }
    if ("usePointerCursors" in p) {
      broadcast("settings:appearance-changed", {
        usePointerCursors: current.usePointerCursors,
      });
    }
    console.log("[settings] saved", current);
    // Shallow copy so renderer setState always sees a new reference.
    return { ...current };
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

  warmAgentCapabilitiesCache(s.codexBinaryPath, s.claudeBinaryPath);

  const normalized = normalizeAgentModelSettings(s);
  const settingsChanged =
    normalized.codexModel !== s.codexModel ||
    normalized.codexEffort !== s.codexEffort ||
    normalized.claudeModel !== s.claudeModel ||
    normalized.claudeEffort !== s.claudeEffort;

  if (settingsChanged) {
    Object.assign(s, normalized);
  }

  if (storiesDir !== loadedStories || runsDir !== loadedRuns || settingsChanged) {
    await persistSettings(s);
  }

  _settings = s;
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
