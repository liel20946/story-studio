import * as React from "react";
import type { ThemePreference } from "./contract-types";
import type { ThemeMode } from "./color-themes";
import { normalizeAppSettings } from "./app-settings";
import { setCachedAppSettings } from "./settings-cache";
import { settingsGet } from "./ipc";
import { clearColorThemeOverrides } from "./color-theme-apply";

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

/** @deprecated Color themes removed — kept for call-site compatibility. */
export function activeColorThemeForMode(): "default" {
  return "default";
}

/** @deprecated Color themes removed — kept for call-site compatibility. */
export function activeColorTheme(): "default" {
  return "default";
}

export type { AppearanceSettings } from "./color-theme-config";

export interface ColorThemePreferences {
  colorThemeLight?: string;
  colorThemeDark?: string;
}

/**
 * Apply light/dark class only. Color presets / custom palettes are retired —
 * tokens live in globals.css (:root / .dark).
 */
export function applyAppearance(
  theme: ThemePreference,
  appearance?: { usePointerCursors?: boolean } | null,
): void {
  resetThemeStyles();
  const resolved = resolveTheme(theme);
  document.documentElement.classList.toggle("dark", resolved === "dark");
  delete document.documentElement.dataset.colorTheme;
  void window.electronAPI.invoke("window:setSidebarVibrancy", {
    enabled: false,
  });
  const usePointer =
    typeof appearance?.usePointerCursors === "boolean"
      ? appearance.usePointerCursors
      : normalizeAppSettings(appearance as never).usePointerCursors;
  document.documentElement.classList.toggle("use-pointer-cursors", usePointer);
}

/** @deprecated Use applyAppearance instead. */
export function applyTheme(theme: ThemePreference): void {
  applyAppearance(theme, normalizeAppSettings(null));
}

/** Sync document theme with saved app settings. */
export function useTheme(): void {
  React.useEffect(() => {
    let preference: ThemePreference = "dark";
    let usePointerCursors = false;
    let cancelled = false;
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    const sync = () => {
      if (cancelled) return;
      applyAppearance(preference, { usePointerCursors });
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
        usePointerCursors = normalized.usePointerCursors;
        sync();
      })
      .catch(() => {
        if (cancelled) return;
        preference = "dark";
        usePointerCursors = false;
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

    // Ignore legacy color-theme events — CSS tokens are fixed per light/dark.
    const unsubscribeColorTheme = window.electronAPI.on(
      "settings:color-theme-changed",
      () => {
        sync();
      },
    );

    const unsubscribeAppearance = window.electronAPI.on(
      "settings:appearance-changed",
      (payload: unknown) => {
        const data = payload as { usePointerCursors?: boolean };
        if (typeof data.usePointerCursors !== "boolean") return;
        usePointerCursors = data.usePointerCursors;
        setCachedAppSettings({ usePointerCursors });
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
