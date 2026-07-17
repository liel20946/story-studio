import type { ColorThemeId, ColorThemePalette } from "./color-themes";
import { DEFAULT_COLOR_THEME_CONTRAST } from "./color-theme-config";
import { hexToRgb, mixHex } from "./color-utils";

const COLOR_THEME_PROPS = [
  "--bg",
  "--bg-secondary",
  "--bg-elevated",
  "--fg",
  "--theme-accent",
  "--accent",
  "--selection",
  "--color-text-primary",
  "--color-text-secondary",
  "--color-text-tertiary",
  "--color-text-quaternary",
  "--color-surface-control",
  "--color-surface-control-subtle",
  "--color-surface-hover",
  "--color-surface-well",
  "--color-surface-sidebar",
  "--color-surface-popover",
  "--color-border-separator",
  "--color-border-field",
  "--color-window-bg",
  "--glass-bg",
  "--glass-bg-elevated",
  "--accent-glow",
] as const;

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.03928
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(foreground: string, background: string): number {
  const fg = relativeLuminance(foreground);
  const bg = relativeLuminance(background);
  const lighter = Math.max(fg, bg);
  const darker = Math.min(fg, bg);
  return (lighter + 0.05) / (darker + 0.05);
}

function ensureContrast(
  foreground: string,
  background: string,
  minRatio: number,
): string {
  if (contrastRatio(foreground, background) >= minRatio) {
    return foreground;
  }

  let adjusted = foreground;
  for (let step = 0; step < 16; step += 1) {
    adjusted = mixHex(adjusted, "#000000", 0.12);
    if (contrastRatio(adjusted, background) >= minRatio) {
      return adjusted;
    }
  }

  return "#111111";
}

/** Push surface/ink apart or together; accent is unchanged. 60 = palette as-is. */
export function applyPaletteContrast(
  palette: ColorThemePalette,
  mode: "light" | "dark",
  contrast: number,
): ColorThemePalette {
  const { accent, surface, ink } = palette;
  if (contrast === DEFAULT_COLOR_THEME_CONTRAST) {
    return palette;
  }

  const delta = (contrast - DEFAULT_COLOR_THEME_CONTRAST) / 40;
  const blend = Math.min(1, Math.abs(delta) * 0.55);

  if (delta < 0) {
    const midpoint = mixHex(surface, ink, 0.5);
    return {
      accent,
      surface: mixHex(surface, midpoint, blend),
      ink: mixHex(ink, midpoint, blend),
    };
  }

  const surfaceTarget = mode === "dark" ? "#000000" : "#ffffff";
  const inkTarget = mode === "dark" ? "#ffffff" : "#000000";
  return {
    accent,
    surface: mixHex(surface, surfaceTarget, blend),
    ink: mixHex(ink, inkTarget, blend),
  };
}

function normalizeLightPalette(palette: ColorThemePalette): ColorThemePalette {
  const ink = ensureContrast(palette.ink, palette.surface, 4.5);
  return ink === palette.ink ? palette : { ...palette, ink };
}

/** Subtle sidebar lift — between flat `bg` and glass `bg-secondary` (0.06). */
const DARK_SIDEBAR_SURFACE_LIFT = 0.035;
const LIGHT_SIDEBAR_SURFACE_LIFT = 0.035;

/** Cursor Dark Anysphere — extracted from Cursor.app theme-cursor (see DESIGN.md). */
function deriveCursorThemeVariables(
  palette: ColorThemePalette,
  mode: "light" | "dark",
): Record<string, string> {
  const accent = palette.accent;

  if (mode === "dark") {
    return {
      "--bg": "#141414",
      "--bg-secondary": "#181818",
      "--bg-elevated": "#1c1c1c",
      "--fg": "rgb(228 228 228 / 92%)",
      "--theme-accent": accent,
      "--accent": accent,
      "--selection": "rgb(228 228 228 / 92%)",
      "--color-text-primary": "rgb(228 228 228 / 92%)",
      "--color-text-secondary": "rgb(228 228 228 / 55%)",
      "--color-text-tertiary": "rgb(228 228 228 / 37%)",
      "--color-text-quaternary": "rgb(228 228 228 / 25%)",
      "--color-surface-control": "rgb(228 228 228 / 4%)",
      "--color-surface-control-subtle": "rgb(228 228 228 / 4%)",
      "--color-surface-hover": "rgb(228 228 228 / 7%)",
      "--color-surface-well": "rgb(228 228 228 / 4%)",
      "--color-surface-sidebar": "transparent",
      "--color-surface-popover": "#141414",
      "--color-border-separator": "rgb(228 228 228 / 7%)",
      "--color-border-field": "rgb(228 228 228 / 15%)",
      "--color-window-bg": "transparent",
      "--glass-bg": "#141414",
      "--glass-bg-elevated": "#181818",
      "--accent-glow": "rgb(129 161 193 / 22%)",
      "--accent-contrast": "#191c22",
    };
  }

  return {
    "--bg": "#f3f3f3",
    "--bg-secondary": "#ffffff",
    "--bg-elevated": "#ffffff",
    "--fg": "#1e1e1e",
    "--theme-accent": accent,
    "--accent": accent,
    "--selection": "#1e1e1e",
    "--color-text-primary": "#1e1e1e",
    "--color-text-secondary": "#5a5a5a",
    "--color-text-tertiary": "#7a7a7a",
    "--color-text-quaternary": "#9a9a9a",
    "--color-surface-control": "rgb(0 0 0 / 6%)",
    "--color-surface-control-subtle": "rgb(0 0 0 / 4%)",
    "--color-surface-hover": "rgb(0 0 0 / 8%)",
    "--color-surface-well": "rgb(0 0 0 / 4%)",
    "--color-surface-sidebar": "transparent",
    "--color-surface-popover": "rgb(255 255 255 / 92%)",
    "--color-border-separator": "rgb(0 0 0 / 8%)",
    "--color-border-field": "rgb(0 0 0 / 12%)",
    "--color-window-bg": "transparent",
    "--glass-bg": "rgb(255 255 255 / 55%)",
    "--glass-bg-elevated": "rgb(255 255 255 / 85%)",
    "--accent-glow": `rgb(from ${accent} r g b / 18%)`,
  };
}

function deriveThemeVariables(
  palette: ColorThemePalette,
  mode: "light" | "dark",
  contrast = DEFAULT_COLOR_THEME_CONTRAST,
  themeId?: ColorThemeId,
): Record<string, string> {
  if (themeId === "cursor") {
    return deriveCursorThemeVariables(palette, mode);
  }
  const contrasted = applyPaletteContrast(palette, mode, contrast);
  const normalized =
    mode === "light" ? normalizeLightPalette(contrasted) : contrasted;
  const { surface, accent } = normalized;
  const ink = normalized.ink;
  const white = "#ffffff";
  const black = "#000000";

  if (mode === "dark") {
    const bg = surface;
    const bgSecondary = mixHex(surface, white, 0.06);
    const bgElevated = mixHex(surface, white, 0.12);
    const windowBg = mixHex(surface, black, 0.25);
    const surfaceControl = mixHex(surface, white, 0.1);
    const surfaceControlSubtle = mixHex(surface, white, 0.06);
    const borderSeparator = mixHex(surface, ink, 0.18);
    const borderField = mixHex(surface, ink, 0.28);
    const sidebarSurface = mixHex(surface, white, DARK_SIDEBAR_SURFACE_LIFT);

    return {
      "--bg": bg,
      "--bg-secondary": bgSecondary,
      "--bg-elevated": bgElevated,
      "--fg": ink,
      "--theme-accent": accent,
      "--accent": accent,
      "--selection": ink,
      "--color-text-primary": ink,
      "--color-text-secondary": mixHex(ink, surface, 0.35),
      "--color-text-tertiary": mixHex(ink, surface, 0.55),
      "--color-text-quaternary": mixHex(ink, surface, 0.7),
      "--color-surface-control": surfaceControl,
      "--color-surface-control-subtle": surfaceControlSubtle,
      "--color-surface-hover": surfaceControl,
      "--color-surface-well": surfaceControlSubtle,
      "--color-surface-sidebar": sidebarSurface,
      "--color-surface-popover": bgElevated,
      "--color-border-separator": borderSeparator,
      "--color-border-field": borderField,
      "--color-window-bg": windowBg,
      "--glass-bg": bgSecondary,
      "--glass-bg-elevated": bgElevated,
      "--accent-glow": `rgb(from ${accent} r g b / 22%)`,
    };
  }

  const bg = surface;
  const bgSecondary = mixHex(surface, white, 0.28);
  const bgElevated = mixHex(surface, white, 0.45);
  const windowBg = mixHex(surface, black, 0.05);
  const surfaceControl = mixHex(surface, black, 0.08);
  const surfaceControlSubtle = mixHex(surface, black, 0.05);
  const borderSeparator = mixHex(surface, black, 0.16);
  const borderField = mixHex(surface, black, 0.26);
  const mutedInk = "#475569";

  const textSecondary = ensureContrast(
    mixHex(ink, mutedInk, 0.28),
    surface,
    3.2,
  );
  const textTertiary = ensureContrast(
    mixHex(ink, mutedInk, 0.48),
    surface,
    2.8,
  );
  const textQuaternary = ensureContrast(
    mixHex(ink, mutedInk, 0.66),
    surface,
    2.3,
  );
  const sidebarSurface = mixHex(surface, black, LIGHT_SIDEBAR_SURFACE_LIFT);

  return {
    "--bg": bg,
    "--bg-secondary": bgSecondary,
    "--bg-elevated": bgElevated,
    "--fg": ink,
    "--theme-accent": accent,
    "--accent": accent,
    "--selection": ink,
    "--color-text-primary": ink,
    "--color-text-secondary": textSecondary,
    "--color-text-tertiary": textTertiary,
    "--color-text-quaternary": textQuaternary,
    "--color-surface-control": surfaceControl,
    "--color-surface-control-subtle": surfaceControlSubtle,
    "--color-surface-hover": mixHex(surface, black, 0.1),
    "--color-surface-well": surfaceControlSubtle,
    "--color-surface-sidebar": sidebarSurface,
    "--color-surface-popover": bgElevated,
    "--color-border-separator": borderSeparator,
    "--color-border-field": borderField,
    "--color-window-bg": windowBg,
    "--glass-bg": bgSecondary,
    "--glass-bg-elevated": bgElevated,
    "--accent-glow": `rgb(from ${accent} r g b / 18%)`,
  };
}

export function clearColorThemeOverrides(): void {
  const root = document.documentElement;
  for (const prop of COLOR_THEME_PROPS) {
    root.style.removeProperty(prop);
  }
}

export function applyColorThemePalette(
  palette: ColorThemePalette,
  mode: "light" | "dark",
  contrast = DEFAULT_COLOR_THEME_CONTRAST,
  themeId?: ColorThemeId,
): void {
  clearColorThemeOverrides();

  const variables = deriveThemeVariables(palette, mode, contrast, themeId);
  const root = document.documentElement;
  for (const [prop, value] of Object.entries(variables)) {
    root.style.setProperty(prop, value);
  }
}
