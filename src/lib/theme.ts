import * as React from "react";
import type { ThemePreference } from "./contract-types";
import { settingsGet } from "./ipc";

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
}

export function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolveTheme(theme: ThemePreference): "light" | "dark" {
  if (theme === "system") {
    return systemPrefersDark() ? "dark" : "light";
  }
  return theme;
}

/** Apply the resolved light/dark class for a theme preference. */
export function applyTheme(theme: ThemePreference): void {
  resetThemeStyles();
  document.documentElement.classList.toggle("dark", resolveTheme(theme) === "dark");
}

/** Sync document theme class with saved app settings. */
export function useTheme(): void {
  React.useEffect(() => {
    let preference: ThemePreference = "dark";
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    const sync = () => {
      applyTheme(preference);
    };

    const onSystemThemeChange = () => {
      if (preference === "system") {
        sync();
      }
    };

    mediaQuery.addEventListener("change", onSystemThemeChange);

    settingsGet()
      .then((settings) => {
        preference = settings.theme;
        sync();
      })
      .catch(() => {
        preference = "dark";
        sync();
      });

    const unsubscribe = window.electronAPI.on(
      "settings:theme-changed",
      (payload: unknown) => {
        const data = payload as { theme?: ThemePreference };
        if (
          data.theme === "system" ||
          data.theme === "light" ||
          data.theme === "dark"
        ) {
          preference = data.theme;
          sync();
        }
      },
    );

    return () => {
      mediaQuery.removeEventListener("change", onSystemThemeChange);
      unsubscribe();
    };
  }, []);
}
