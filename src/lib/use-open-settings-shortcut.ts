import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";

/** Cmd+, / Ctrl+, — opens in-app settings (matches sidebar gear + app menu). */
export function useOpenSettingsShortcut() {
  const navigate = useNavigate();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      if (event.altKey || event.shiftKey) return;
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.code !== "Comma") return;

      event.preventDefault();
      navigate({ to: "/settings", search: { section: "appearance" } });
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate]);
}
