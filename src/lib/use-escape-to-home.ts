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
  const isGenerateHome = pathname === "/" || pathname === "/generate";
  const isStoriesHome = pathname === "/stories";
  const isScheduledHome = pathname === "/scheduled";
  const isSettings = pathname === "/settings";

  useEffect(() => {
    if (isGenerateHome || isStoriesHome || isScheduledHome) return;

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
      if (pathname.startsWith("/generate/")) {
        navigate({ to: "/" });
        return;
      }
      navigate({ to: "/stories" });
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isGenerateHome, isStoriesHome, isScheduledHome, isSettings, navigate, pathname, router]);
}
