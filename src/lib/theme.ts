import * as React from "react";
import type { ThemePreference } from "./contract-types";
import type { ColorThemeId } from "./color-themes";
import {
  colorThemeAvailable,
  DEFAULT_COLOR_THEME_ID,
  type ThemeMode,
} from "./color-themes";
import {
  type AppearanceSettings,
  resolveEffectiveContrast,
  resolveEffectivePalette,
  resolveEffectiveOpacity,
  WINDOW_OPACITY_TRANSITION_MS,
} from "./color-theme-config";
import { applyColorThemePalette, clearColorThemeOverrides } from "./color-theme-apply";
import { normalizeAppSettings } from "./app-settings";
import { setCachedAppSettings } from "./settings-cache";
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

const WINDOW_OPACITY_PROPS = [
  "--window-bg-opacity",
  "--window-bg-blur",
  "--window-bg-saturate",
] as const;

function clearWindowOpacityOverrides(): void {
  const root = document.documentElement;
  for (const prop of WINDOW_OPACITY_PROPS) {
    root.style.removeProperty(prop);
  }
  root.classList.remove("window-opacity-active");
}

function setWindowOpacityVars(opacity: number): void {
  const root = document.documentElement;
  const clamped = Math.min(100, Math.max(0, Math.round(opacity)));
  const alpha = clamped / 100;
  const blurPx = ((100 - clamped) / 100) * 40;
  const saturate = 100 + ((100 - clamped) / 100) * 80;
  root.style.setProperty("--window-bg-opacity", String(alpha));
  root.style.setProperty("--window-bg-blur", `${blurPx}px`);
  root.style.setProperty("--window-bg-saturate", `${saturate}%`);
}

function readCurrentWindowOpacity(): number {
  const root = document.documentElement;
  const inline = root.style.getPropertyValue("--window-bg-opacity").trim();
  const raw =
    inline || getComputedStyle(root).getPropertyValue("--window-bg-opacity").trim();
  const alpha = Number.parseFloat(raw);
  if (!Number.isNaN(alpha)) {
    return Math.round(alpha * 100);
  }
  return root.classList.contains("window-opacity-active") ? 0 : 100;
}

/** 100 = fully opaque, no blur; lower values add transparency and backdrop blur. */
export function applyWindowOpacity(opacity: number): void {
  const root = document.documentElement;
  const clamped = Math.min(100, Math.max(0, Math.round(opacity)));
  setWindowOpacityVars(clamped);
  root.classList.toggle("window-opacity-active", clamped < 100);
}

/** Smoothly animate window opacity like the former slider (all windows via IPC). */
export function transitionWindowOpacity(toOpacity: number): Promise<void> {
  const to = Math.min(100, Math.max(0, Math.round(toOpacity)));
  const from = readCurrentWindowOpacity();
  if (from === to) return Promise.resolve();

  const root = document.documentElement;
  const enablingBlur = to < from;

  return new Promise((resolve) => {
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;
      root.classList.remove("window-opacity-transitioning");
      root.removeEventListener("transitionend", onTransitionEnd);
      window.clearTimeout(fallbackTimer);
      applyWindowOpacity(to);
      resolve();
    };

    const onTransitionEnd = (event: TransitionEvent) => {
      if (event.target !== root) return;
      if (event.propertyName !== "--window-bg-opacity") return;
      finish();
    };

    root.classList.add("window-opacity-transitioning");
    if (enablingBlur) {
      root.classList.add("window-opacity-active");
    }

    root.addEventListener("transitionend", onTransitionEnd);
    const fallbackTimer = window.setTimeout(
      finish,
      WINDOW_OPACITY_TRANSITION_MS + 50,
    );

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setWindowOpacityVars(to);
      });
    });
  });
}

/** @deprecated Use applyWindowOpacity */
export const applyWindowTransparency = applyWindowOpacity;


export type { AppearanceSettings } from "./color-theme-config";

export interface ColorThemePreferences {
  colorThemeLight: ColorThemeId;
  colorThemeDark: ColorThemeId;
}

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
  clearWindowOpacityOverrides();
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
    : DEFAULT_COLOR_THEME_ID;
  const effectiveSettings: AppearanceSettings = {
    ...settings,
    ...(resolved === "light"
      ? { colorThemeLight: effectiveColorTheme }
      : { colorThemeDark: effectiveColorTheme }),
  };
  const palette = resolveEffectivePalette(effectiveSettings, resolved);
  const contrast = resolveEffectiveContrast(settings, resolved);
  const opacity = resolveEffectiveOpacity(settings, resolved);
  applyColorThemePalette(palette, resolved, contrast);
  applyWindowOpacity(opacity);
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

    const unsubscribeOpacityTransition = window.electronAPI.on(
      "settings:opacity-transition",
      (payload: unknown) => {
        const data = payload as { opacity?: number };
        if (typeof data.opacity !== "number" || Number.isNaN(data.opacity)) return;
        void transitionWindowOpacity(data.opacity);
      },
    );

    return () => {
      cancelled = true;
      mediaQuery.removeEventListener("change", onSystemThemeChange);
      unsubscribeTheme();
      unsubscribeColorTheme();
      unsubscribeAppearance();
      unsubscribeOpacityTransition();
    };
  }, []);
}
