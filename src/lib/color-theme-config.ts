import type { ColorThemeId, ColorThemePalette, ThemeMode } from "./color-themes";
import {
  DEFAULT_COLOR_THEME_ID,
  getColorThemeDefinition,
  parseColorThemeId,
  resolveColorThemePalette,
} from "./color-themes";

export const DEFAULT_COLOR_THEME_CONTRAST = 60;
export const DEFAULT_COLOR_THEME_OPACITY = 100;
/** @deprecated Use DEFAULT_COLOR_THEME_OPACITY */
export const DEFAULT_COLOR_THEME_TRANSPARENCY = DEFAULT_COLOR_THEME_OPACITY;
/** Codex-compatible clipboard prefix (import accepts; export uses same). */
export const CODEX_THEME_CLIPBOARD_PREFIX = "codex-theme-v1:";

export interface ImportedColorTheme {
  preset: ColorThemeId;
  accent: string;
  surface: string;
  ink: string;
  contrast: number;
  variant: ThemeMode;
}

export interface ModeColorThemeSettings {
  preset: ColorThemeId;
  palette: ColorThemePalette | null;
  contrast: number;
  opacity: number;
}

export interface AppearanceSettings {
  colorThemeLight: ColorThemeId;
  colorThemeDark: ColorThemeId;
  colorThemePaletteLight: ColorThemePalette | null;
  colorThemePaletteDark: ColorThemePalette | null;
  colorThemeContrastLight: number;
  colorThemeContrastDark: number;
  colorThemeOpacityLight: number;
  colorThemeOpacityDark: number;
}

/** Codex export shape (subset we read/write). */
interface CodexThemeClipboardPayload {
  codeThemeId?: unknown;
  variant?: unknown;
  theme?: {
    accent?: unknown;
    surface?: unknown;
    ink?: unknown;
    contrast?: unknown;
    fonts?: unknown;
    opaqueWindows?: unknown;
    semanticColors?: unknown;
  };
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value);
}

export function normalizeHexColor(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (HEX_COLOR.test(trimmed)) return trimmed.toLowerCase();
  const withHash = `#${trimmed.replace("#", "")}`;
  if (HEX_COLOR.test(withHash)) return withHash.toLowerCase();
  return fallback;
}

export function parseColorThemePalette(
  value: unknown,
): ColorThemePalette | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<ColorThemePalette>;
  if (
    !isHexColor(record.accent) ||
    !isHexColor(record.surface) ||
    !isHexColor(record.ink)
  ) {
    return null;
  }
  return {
    accent: record.accent.toLowerCase(),
    surface: record.surface.toLowerCase(),
    ink: record.ink.toLowerCase(),
  };
}

export function parseColorThemeContrast(
  value: unknown,
  fallback = DEFAULT_COLOR_THEME_CONTRAST,
): number {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return Math.min(100, Math.max(0, Math.round(value)));
}

export function parseColorThemeOpacity(
  value: unknown,
  fallback = DEFAULT_COLOR_THEME_OPACITY,
): number {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/** @deprecated Use parseColorThemeOpacity */
export const parseColorThemeTransparency = parseColorThemeOpacity;

function parseThemeVariant(value: unknown): ThemeMode | null {
  if (value === "light" || value === "dark") return value;
  return null;
}

function unwrapClipboardPayload(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed.startsWith(CODEX_THEME_CLIPBOARD_PREFIX)) {
    return JSON.parse(trimmed.slice(CODEX_THEME_CLIPBOARD_PREFIX.length));
  }
  return JSON.parse(trimmed);
}

function parseCodexClipboardPayload(
  parsed: CodexThemeClipboardPayload,
): ImportedColorTheme | null {
  const variant = parseThemeVariant(parsed.variant);
  const theme = parsed.theme;
  if (!variant || !theme) return null;

  const preset = parseColorThemeId(parsed.codeThemeId, DEFAULT_COLOR_THEME_ID);
  const fallback = resolveColorThemePalette(preset, variant);
  const accent = normalizeHexColor(theme.accent, fallback.accent);
  const surface = normalizeHexColor(theme.surface, fallback.surface);
  const ink = normalizeHexColor(theme.ink, fallback.ink);
  const contrast = parseColorThemeContrast(theme.contrast);

  if (!isHexColor(accent) || !isHexColor(surface) || !isHexColor(ink)) {
    return null;
  }

  return { preset, accent, surface, ink, contrast, variant };
}

export function modeColorThemeSettings(
  settings: AppearanceSettings,
  mode: ThemeMode,
): ModeColorThemeSettings {
  const preset =
    mode === "light" ? settings.colorThemeLight : settings.colorThemeDark;
  return {
    preset,
    palette:
      mode === "light"
        ? settings.colorThemePaletteLight
        : settings.colorThemePaletteDark,
    contrast:
      mode === "light"
        ? settings.colorThemeContrastLight
        : settings.colorThemeContrastDark,
    opacity:
      mode === "light"
        ? settings.colorThemeOpacityLight
        : settings.colorThemeOpacityDark,
  };
}

export function resolveEffectivePalette(
  settings: AppearanceSettings,
  mode: ThemeMode,
): ColorThemePalette {
  const { preset, palette } = modeColorThemeSettings(settings, mode);
  const base = resolveColorThemePalette(preset, mode);
  if (!palette) return base;
  return {
    accent: palette.accent,
    surface: palette.surface,
    ink: palette.ink,
  };
}

export function resolveEffectiveContrast(
  settings: AppearanceSettings,
  mode: ThemeMode,
): number {
  return modeColorThemeSettings(settings, mode).contrast;
}

export function resolveEffectiveOpacity(
  settings: AppearanceSettings,
  mode: ThemeMode,
): number {
  return modeColorThemeSettings(settings, mode).opacity;
}

/** @deprecated Use resolveEffectiveOpacity */
export const resolveEffectiveTransparency = resolveEffectiveOpacity;

export function appearancePatchForMode(
  mode: ThemeMode,
  patch: Partial<ModeColorThemeSettings>,
): Partial<AppearanceSettings> {
  if (mode === "light") {
    return {
      ...(patch.preset !== undefined ? { colorThemeLight: patch.preset } : {}),
      ...(patch.palette !== undefined
        ? { colorThemePaletteLight: patch.palette }
        : {}),
      ...(patch.contrast !== undefined
        ? { colorThemeContrastLight: patch.contrast }
        : {}),
      ...(patch.opacity !== undefined
        ? { colorThemeOpacityLight: patch.opacity }
        : {}),
    };
  }
  return {
    ...(patch.preset !== undefined ? { colorThemeDark: patch.preset } : {}),
    ...(patch.palette !== undefined
      ? { colorThemePaletteDark: patch.palette }
      : {}),
    ...(patch.contrast !== undefined
      ? { colorThemeContrastDark: patch.contrast }
      : {}),
    ...(patch.opacity !== undefined
      ? { colorThemeOpacityDark: patch.opacity }
      : {}),
  };
}

/** Export in Codex clipboard format (`codex-theme-v1:{...}`). */
export function exportColorThemeConfig(
  settings: AppearanceSettings,
  mode: ThemeMode,
): string {
  const { preset, contrast } = modeColorThemeSettings(settings, mode);
  const palette = resolveEffectivePalette(settings, mode);
  const payload: CodexThemeClipboardPayload = {
    codeThemeId: preset,
    variant: mode,
    theme: {
      accent: palette.accent,
      surface: palette.surface,
      ink: palette.ink,
      contrast,
    },
  };
  return `${CODEX_THEME_CLIPBOARD_PREFIX}${JSON.stringify(payload)}`;
}

/**
 * Parse a Codex clipboard string (or legacy JSON). Only accent, surface, ink,
 * contrast, codeThemeId, and variant are used; fonts, semanticColors, etc. are ignored.
 */
export function parseImportedColorTheme(raw: string): ImportedColorTheme | null {
  try {
    const parsed = unwrapClipboardPayload(raw) as CodexThemeClipboardPayload;
    return parseCodexClipboardPayload(parsed);
  } catch {
    return null;
  }
}

export function applyImportedColorTheme<T extends AppearanceSettings>(
  settings: T,
  imported: ImportedColorTheme,
): T {
  const palette: ColorThemePalette = {
    accent: imported.accent,
    surface: imported.surface,
    ink: imported.ink,
  };
  const preset = getColorThemeDefinition(imported.preset)
    ? imported.preset
    : DEFAULT_COLOR_THEME_ID;
  const patch = appearancePatchForMode(imported.variant, {
    preset,
    palette,
    contrast: imported.contrast,
  });
  return { ...settings, ...patch };
}
