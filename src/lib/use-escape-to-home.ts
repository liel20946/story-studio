import { useEffect } from "react";
import { useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import { shouldIgnoreEscapeKey } from "./escape-key";
import { navigateBackFromSettings } from "./return-from-settings";

/** Escape closes the main-pane detail view and returns to the tab home screen. */
export function useEscapeToHome() {
  const navigate = useNavigate();
  const router = useRouter();
  const pathname = useRouterState({
    select: (s) => s.location.pathname,
  });
  const isHome = pathname === "/";
  const isScheduledHome = pathname === "/scheduled";
  const isSettings = pathname === "/settings";

  useEffect(() => {
    if (isHome || isScheduledHome) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreEscapeKey(event)) return;

      event.preventDefault();
      if (isSettings) {
        navigateBackFromSettings(router);
        return;
      }
      if (pathname.startsWith("/scheduled/")) {
        navigate({ to: "/scheduled" });
        return;
      }
      navigate({ to: "/" });
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isHome, isScheduledHome, isSettings, navigate, pathname, router]);
}
