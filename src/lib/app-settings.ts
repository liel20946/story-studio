import type { AppSettings } from "./contract-types";
import {
  DEFAULT_COLOR_THEME_CONTRAST,
  DEFAULT_COLOR_THEME_OPACITY,
  parseColorThemeContrast,
  parseColorThemeOpacity,
  parseColorThemePalette,
} from "./color-theme-config";
import { parseColorThemeId, type ColorThemeId } from "./color-themes";

export const DEFAULT_APP_SETTINGS: AppSettings = {
  agentProvider: "codex",
  codexBinaryPath: null,
  claudeBinaryPath: null,
  codexModel: "gpt-5.5",
  codexEffort: "medium",
  claudeModel: "sonnet",
  claudeEffort: "medium",
  storiesDir: "",
  runsDir: "",
  theme: "dark",
  colorThemeLight: "raycast",
  colorThemeDark: "raycast",
  colorThemePaletteLight: null,
  colorThemePaletteDark: null,
  colorThemeContrastLight: DEFAULT_COLOR_THEME_CONTRAST,
  colorThemeContrastDark: DEFAULT_COLOR_THEME_CONTRAST,
  colorThemeOpacityLight: DEFAULT_COLOR_THEME_OPACITY,
  colorThemeOpacityDark: DEFAULT_COLOR_THEME_OPACITY,
  usePointerCursors: false,
  startingUrl: "https://example.com",
  runHook: "",
};

function parseThemePreference(
  value: unknown,
  fallback: AppSettings["theme"],
): AppSettings["theme"] {
  if (value === "system" || value === "light" || value === "dark") {
    return value;
  }
  return fallback;
}

type LegacyAppSettings = Partial<AppSettings> & {
  colorTheme?: ColorThemeId;
};

function parseColorThemeFields(
  base: LegacyAppSettings,
  defaults: AppSettings,
): Pick<AppSettings, "colorThemeLight" | "colorThemeDark"> {
  const legacy = base.colorTheme;
  return {
    colorThemeLight: parseColorThemeId(
      base.colorThemeLight ?? legacy,
      defaults.colorThemeLight,
    ),
    colorThemeDark: parseColorThemeId(
      base.colorThemeDark ?? legacy,
      defaults.colorThemeDark,
    ),
  };
}

/** Merge partial IPC settings with defaults so optional fields never come back undefined. */
export function normalizeAppSettings(
  partial: LegacyAppSettings | null | undefined,
): AppSettings {
  const base = partial ?? {};
  const colorThemes = parseColorThemeFields(base, DEFAULT_APP_SETTINGS);
  return {
    ...DEFAULT_APP_SETTINGS,
    ...base,
    theme: parseThemePreference(base.theme, DEFAULT_APP_SETTINGS.theme),
    colorThemeLight: colorThemes.colorThemeLight,
    colorThemeDark: colorThemes.colorThemeDark,
    colorThemePaletteLight:
      parseColorThemePalette(base.colorThemePaletteLight) ??
      DEFAULT_APP_SETTINGS.colorThemePaletteLight,
    colorThemePaletteDark:
      parseColorThemePalette(base.colorThemePaletteDark) ??
      DEFAULT_APP_SETTINGS.colorThemePaletteDark,
    colorThemeContrastLight: parseColorThemeContrast(
      base.colorThemeContrastLight,
      DEFAULT_APP_SETTINGS.colorThemeContrastLight,
    ),
    colorThemeContrastDark: parseColorThemeContrast(
      base.colorThemeContrastDark,
      DEFAULT_APP_SETTINGS.colorThemeContrastDark,
    ),
    colorThemeOpacityLight: parseColorThemeOpacity(
      base.colorThemeOpacityLight ??
        (base as { colorThemeTransparencyLight?: number })
          .colorThemeTransparencyLight,
      DEFAULT_APP_SETTINGS.colorThemeOpacityLight,
    ),
    colorThemeOpacityDark: parseColorThemeOpacity(
      base.colorThemeOpacityDark ??
        (base as { colorThemeTransparencyDark?: number })
          .colorThemeTransparencyDark,
      DEFAULT_APP_SETTINGS.colorThemeOpacityDark,
    ),
    usePointerCursors:
      typeof base.usePointerCursors === "boolean"
        ? base.usePointerCursors
        : DEFAULT_APP_SETTINGS.usePointerCursors,
  };
}
