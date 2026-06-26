import { useRouterState } from "@tanstack/react-router";
import {
  parseSettingsSection,
  type SettingsSection,
} from "../components/settings-sections";

/** Active settings section — safe from RootView and /settings route components. */
export function useSettingsSection(): SettingsSection {
  return useRouterState({
    select: (state) => {
      const settingsMatch = state.matches.find(
        (match) => match.routeId === "/settings",
      );
      if (settingsMatch?.search) {
        const search = settingsMatch.search as { section?: unknown };
        return parseSettingsSection(search.section);
      }

      if (state.location.pathname === "/settings") {
        const search = state.location.search as { section?: unknown };
        return parseSettingsSection(search?.section);
      }

      return "appearance";
    },
  });
}
