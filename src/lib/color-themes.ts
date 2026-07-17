export type ThemeMode = "light" | "dark";

export interface ColorThemePalette {
  accent: string;
  ink: string;
  surface: string;
}

export interface ColorThemeDefinition {
  id: string;
  name: string;
  light: ColorThemePalette;
  dark: ColorThemePalette;
}

/**
 * Codex chrome theme colors (surface / ink / accent).
 * Paired light/dark values from Codex app.asar presets and official theme families.
 */
export const DEFAULT_COLOR_THEME_ID = "raycast" as const;
export const DEFAULT_DARK_COLOR_THEME_ID = "cursor" as const;

export const COLOR_THEMES: ColorThemeDefinition[] = [
  {
    id: "cursor",
    name: "Cursor",
    light: { accent: "#3b82f6", ink: "#1e1e1e", surface: "#f3f3f3" },
    dark: { accent: "#81a1c1", ink: "#e4e4e4", surface: "#141414" },
  },
  {
    id: "codex",
    name: "Codex",
    light: { accent: "#0169cc", ink: "#0d0d0d", surface: "#ffffff" },
    dark: { accent: "#0169cc", ink: "#ffffff", surface: "#181818" },
  },
  {
    id: "raycast",
    name: "Raycast",
    light: { accent: "#ff6363", ink: "#030303", surface: "#ffffff" },
    dark: { accent: "#ff6363", ink: "#fefefe", surface: "#101010" },
  },
  {
    id: "absolutely",
    name: "Absolutely",
    light: { accent: "#da7756", ink: "#210124", surface: "#f5f3ee" },
    dark: { accent: "#d97757", ink: "#f2ebe3", surface: "#1c1512" },
  },
  {
    id: "ayu",
    name: "Ayu",
    light: { accent: "#ff9940", ink: "#5c6166", surface: "#fafafa" },
    dark: { accent: "#e6b450", ink: "#bfbdb6", surface: "#0b0e14" },
  },
  {
    id: "catppuccin",
    name: "Catppuccin",
    light: { accent: "#8839ef", ink: "#4c4f69", surface: "#eff1f5" },
    dark: { accent: "#cba6f7", ink: "#cdd6f4", surface: "#1e1e2e" },
  },
  {
    id: "dracula",
    name: "Dracula",
    light: { accent: "#7c4dff", ink: "#1d1d20", surface: "#fffbfe" },
    dark: { accent: "#bd93f9", ink: "#f8f8f2", surface: "#282a36" },
  },
  {
    id: "everforest",
    name: "Everforest",
    light: { accent: "#5f8a2e", ink: "#425047", surface: "#fdf6e3" },
    dark: { accent: "#a7c080", ink: "#d3c6aa", surface: "#2d353b" },
  },
  {
    id: "github",
    name: "GitHub",
    light: { accent: "#0969da", ink: "#1f2328", surface: "#ffffff" },
    dark: { accent: "#1f6feb", ink: "#e6edf3", surface: "#0d1117" },
  },
  {
    id: "gruvbox",
    name: "Gruvbox",
    light: { accent: "#b57614", ink: "#3c3836", surface: "#fbf1c7" },
    dark: { accent: "#fabd2f", ink: "#ebdbb2", surface: "#282828" },
  },
  {
    id: "linear",
    name: "Linear",
    light: { accent: "#0169cc", ink: "#1b1b1b", surface: "#fcfcfd" },
    dark: { accent: "#606acc", ink: "#e3e4e6", surface: "#0f0f11" },
  },
  {
    id: "monokai",
    name: "Monokai",
    light: { accent: "#86b42b", ink: "#3b3a32", surface: "#fafafa" },
    dark: { accent: "#a6e22e", ink: "#f8f8f2", surface: "#272822" },
  },
  {
    id: "nord",
    name: "Nord",
    light: { accent: "#5e81ac", ink: "#2e3440", surface: "#eceff4" },
    dark: { accent: "#88c0d0", ink: "#d8dee9", surface: "#2e3440" },
  },
  {
    id: "solarized",
    name: "Solarized",
    light: { accent: "#268bd2", ink: "#586e75", surface: "#fdf6e3" },
    dark: { accent: "#2aa198", ink: "#839496", surface: "#002b36" },
  },
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    light: { accent: "#2959aa", ink: "#343b58", surface: "#e1e2e7" },
    dark: { accent: "#7aa2f7", ink: "#a9b1d6", surface: "#1a1b26" },
  },
];

export type ColorThemeId = (typeof COLOR_THEMES)[number]["id"];

/** Themes only selectable in dark mode (e.g. Cursor with native vibrancy). */
const DARK_ONLY_COLOR_THEME_IDS = new Set<ColorThemeId>(["cursor"]);

const THEME_BY_ID = new Map(COLOR_THEMES.map((theme) => [theme.id, theme]));

export function defaultColorThemeForMode(mode: ThemeMode): ColorThemeId {
  return mode === "dark" ? DEFAULT_DARK_COLOR_THEME_ID : DEFAULT_COLOR_THEME_ID;
}

export function isColorThemeId(value: unknown): value is ColorThemeId {
  return typeof value === "string" && THEME_BY_ID.has(value);
}

export function parseColorThemeId(
  value: unknown,
  fallback: ColorThemeId = DEFAULT_COLOR_THEME_ID,
): ColorThemeId {
  if (value === "default") {
    return fallback;
  }
  return isColorThemeId(value) ? value : fallback;
}

export function parseColorThemeIdForMode(
  value: unknown,
  mode: ThemeMode,
  fallback?: ColorThemeId,
): ColorThemeId {
  const resolvedFallback = fallback ?? defaultColorThemeForMode(mode);
  const parsed = parseColorThemeId(value, resolvedFallback);
  return colorThemeAvailable(parsed, mode) ? parsed : resolvedFallback;
}

export function colorThemesForMode(mode: ThemeMode): ColorThemeDefinition[] {
  if (mode === "light") {
    return COLOR_THEMES.filter((theme) => !DARK_ONLY_COLOR_THEME_IDS.has(theme.id));
  }
  return COLOR_THEMES;
}

export function resolveColorThemePalette(
  themeId: ColorThemeId,
  mode: ThemeMode,
): ColorThemePalette {
  const theme =
    THEME_BY_ID.get(themeId) ?? THEME_BY_ID.get(DEFAULT_COLOR_THEME_ID)!;
  return mode === "light" ? theme.light : theme.dark;
}

export function colorThemeAvailable(
  themeId: ColorThemeId,
  mode: ThemeMode,
): boolean {
  if (!THEME_BY_ID.has(themeId)) return false;
  if (mode === "light" && DARK_ONLY_COLOR_THEME_IDS.has(themeId)) return false;
  return true;
}

export function getColorThemeDefinition(
  themeId: ColorThemeId,
): ColorThemeDefinition | undefined {
  return THEME_BY_ID.get(themeId);
}
