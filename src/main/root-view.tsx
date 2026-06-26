import * as React from "react";
import { Outlet, useRouterState } from "@tanstack/react-router";
import { SplitView } from "@/components/ui";
import { cn } from "@/lib/utils";
import { useTheme } from "@/lib/theme";
import { useEscapeToHome } from "@/lib/use-escape-to-home";
import { useOpenSettingsShortcut } from "@/lib/use-open-settings-shortcut";
import { trackAppLocation } from "@/lib/return-from-settings";
import { AppSidebar } from "../components/sidebar";
import { SettingsSidebar } from "../components/settings-sidebar";

export function RootView() {
  useTheme();
  useEscapeToHome();
  useOpenSettingsShortcut();

  const isSettings = useRouterState({
    select: (s) => s.location.pathname === "/settings",
  });
  const location = useRouterState({ select: (s) => s.location });

  React.useEffect(() => {
    trackAppLocation(location);
  }, [location]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SplitView
        sidebar={
          <div className="relative flex h-full min-h-0 flex-col">
            {/* Keep mounted while in settings so tab/search/scroll state survives. */}
            <div
              className={cn(
                "flex min-h-0 flex-1 flex-col",
                isSettings && "invisible pointer-events-none",
              )}
              aria-hidden={isSettings}
            >
              <AppSidebar />
            </div>
            {isSettings ? (
              <div className="absolute inset-0 flex min-h-0 flex-col">
                <SettingsSidebar />
              </div>
            ) : null}
          </div>
        }
        className="h-full"
      >
        <Outlet />
      </SplitView>
    </div>
  );
}
