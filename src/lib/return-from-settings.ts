import { useCallback } from "react";
import type { AnyRouter, ParsedLocation } from "@tanstack/react-router";
import { useRouter } from "@tanstack/react-router";

let lastAppLocation: ParsedLocation | null = null;

/** Remember the latest non-settings route so we can restore it after settings. */
export function trackAppLocation(location: ParsedLocation) {
  if (location.pathname !== "/settings") {
    lastAppLocation = location;
  }
}

export function navigateBackFromSettings(router: AnyRouter) {
  const { history } = router;

  if (history.canGoBack()) {
    history.back();
    return;
  }

  if (lastAppLocation) {
    void router.navigate({ href: lastAppLocation.href });
    return;
  }

  void router.navigate({ to: "/stories" });
}

export function useReturnFromSettings() {
  const router = useRouter();
  return useCallback(() => {
    navigateBackFromSettings(router);
  }, [router]);
}
