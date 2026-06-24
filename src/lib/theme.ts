import * as React from "react";
import { settingsGet } from "./ipc";

/** Sync document theme class with saved app settings. */
export function useTheme(): void {
  React.useEffect(() => {
    settingsGet()
      .then((s) => {
        document.documentElement.classList.toggle("dark", s.theme === "dark");
      })
      .catch(() => {
        // default dark
        document.documentElement.classList.add("dark");
      });
  }, []);
}
