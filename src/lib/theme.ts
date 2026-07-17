import * as React from "react";
import type { ThemePreference } from "./contract-types";
import type { ColorThemeId } from "./color-themes";
import {
  colorThemeAvailable,
  defaultColorThemeForMode,
  type ThemeMode,
} from "./color-themes";
import {
  type AppearanceSettings,
  resolveEffectiveContrast,
  resolveEffectivePalette,
} from "./color-theme-config";
import { applyColorThemePalette, clearColorThemeOverrides } from "./color-theme-apply";
import { normalizeAppSettings } from "./app-settings";
import { setCachedAppSettings } from "./settings-cache";
import { settingsGet } from "./ipc";

function syncSidebarVibrancy(themeId: ColorThemeId): void {
  void window.electronAPI.invoke("window:setSidebarVibrancy", {
    enabled: themeId === "cursor",
  });
}

const LEGACY_APPEARANCE_PROPS = [
  "--bg",
  "--fg",
  "--theme-accent",
  "--accent",
  "--color-window-bg",
  "--color-text-primary",
  "--selection",
  "--color-text-secondary",
  "--color-text-tertiary",
  "--color-text-quaternary",
  "--bg-secondary",
  "--bg-elevated",
  "--color-surface-sidebar",
  "--color-surface-popover",
  "--color-surface-control",
  "--color-surface-control-subtle",
  "--color-surface-hover",
  "--color-surface-well",
  "--color-border-separator",
  "--color-border-field",
  "--glass-bg",
  "--glass-bg-elevated",
  "--accent-glow",
] as const;

function clearLegacyAppearanceOverrides(): void {
  const root = document.documentElement;
  for (const prop of LEGACY_APPEARANCE_PROPS) {
    root.style.removeProperty(prop);
  }
}

/** Remove inline appearance overrides from an older build. */
export function resetThemeStyles(): void {
  clearLegacyAppearanceOverrides();
  clearColorThemeOverrides();
}

export function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolveTheme(theme: ThemePreference): ThemeMode {
  if (theme === "system") {
    return systemPrefersDark() ? "dark" : "light";
  }
  return theme;
}

export function activeColorThemeForMode(
  mode: ThemeMode,
  colorThemes: ColorThemePreferences,
): ColorThemeId {
  return mode === "light"
    ? colorThemes.colorThemeLight
    : colorThemes.colorThemeDark;
}

export function activeColorTheme(
  theme: ThemePreference,
  colorThemes: ColorThemePreferences,
): ColorThemeId {
  return activeColorThemeForMode(resolveTheme(theme), colorThemes);
}

export type { AppearanceSettings } from "./color-theme-config";

export interface ColorThemePreferences {
  colorThemeLight: ColorThemeId;
  colorThemeDark: ColorThemeId;
}

/** Apply light/dark class and the color theme for the resolved mode. */
export function applyAppearance(
  theme: ThemePreference,
  appearance: Partial<AppearanceSettings> & ColorThemePreferences,
): void {
  resetThemeStyles();
  const resolved = resolveTheme(theme);
  document.documentElement.classList.toggle("dark", resolved === "dark");

  const settings = normalizeAppSettings(appearance);
  const colorTheme = activeColorThemeForMode(resolved, settings);
  const effectiveColorTheme = colorThemeAvailable(colorTheme, resolved)
    ? colorTheme
    : defaultColorThemeForMode(resolved);
  const effectiveSettings: AppearanceSettings = {
    ...settings,
    ...(resolved === "light"
      ? { colorThemeLight: effectiveColorTheme }
      : { colorThemeDark: effectiveColorTheme }),
  };
  const palette = resolveEffectivePalette(effectiveSettings, resolved);
  const contrast = resolveEffectiveContrast(settings, resolved);
  applyColorThemePalette(palette, resolved, contrast, effectiveColorTheme);
  document.documentElement.dataset.colorTheme = effectiveColorTheme;
  syncSidebarVibrancy(effectiveColorTheme);
  document.documentElement.classList.toggle(
    "use-pointer-cursors",
    settings.usePointerCursors,
  );
}

/** @deprecated Use applyAppearance instead. */
export function applyTheme(theme: ThemePreference): void {
  applyAppearance(theme, normalizeAppSettings(null));
}

/** Sync document theme with saved app settings. */
export function useTheme(): void {
  React.useEffect(() => {
    let preference: ThemePreference = "dark";
    let appearance: AppearanceSettings = normalizeAppSettings(null);
    let cancelled = false;
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    const sync = () => {
      if (cancelled) return;
      applyAppearance(preference, appearance);
    };

    const onSystemThemeChange = () => {
      if (preference === "system") {
        sync();
      }
    };

    mediaQuery.addEventListener("change", onSystemThemeChange);

    settingsGet()
      .then((settings) => {
        if (cancelled) return;
        const normalized = setCachedAppSettings(settings);
        preference = normalized.theme;
        appearance = normalized;
        sync();
      })
      .catch(() => {
        if (cancelled) return;
        preference = "dark";
        appearance = normalizeAppSettings(null);
        sync();
      });

    const unsubscribeTheme = window.electronAPI.on(
      "settings:theme-changed",
      (payload: unknown) => {
        const data = payload as { theme?: ThemePreference };
        if (
          data.theme === "system" ||
          data.theme === "light" ||
          data.theme === "dark"
        ) {
          preference = data.theme;
          setCachedAppSettings({ theme: data.theme });
          sync();
        }
      },
    );

    const unsubscribeColorTheme = window.electronAPI.on(
      "settings:color-theme-changed",
      (payload: unknown) => {
        const data = payload as Partial<AppearanceSettings>;
        appearance = normalizeAppSettings({ ...appearance, ...data });
        setCachedAppSettings(data);
        sync();
      },
    );

    const unsubscribeAppearance = window.electronAPI.on(
      "settings:appearance-changed",
      (payload: unknown) => {
        const data = payload as { usePointerCursors?: boolean };
        if (typeof data.usePointerCursors !== "boolean") return;
        appearance = normalizeAppSettings({
          ...appearance,
          usePointerCursors: data.usePointerCursors,
        });
        setCachedAppSettings({ usePointerCursors: data.usePointerCursors });
        sync();
      },
    );

    return () => {
      cancelled = true;
      mediaQuery.removeEventListener("change", onSystemThemeChange);
      unsubscribeTheme();
      unsubscribeColorTheme();
      unsubscribeAppearance();
    };
  }, []);
}
