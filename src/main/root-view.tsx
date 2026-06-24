import { Outlet } from "@tanstack/react-router";
import { SplitView, TooltipProvider } from "@/components/ui";
import { useTheme } from "@/lib/theme";
import { AppSidebar } from "../components/sidebar";
import { SettingsSidebar } from "../components/settings-sidebar";
import { useRouterState } from "@tanstack/react-router";

export function RootView() {
  useTheme();

  const isSettings = useRouterState({
    select: (s) => s.location.pathname === "/settings",
  });

  return (
    <TooltipProvider>
      <div className="flex h-full min-h-0 flex-col">
        <SplitView
          sidebar={isSettings ? <SettingsSidebar /> : <AppSidebar />}
          className="h-full"
        >
          <Outlet />
        </SplitView>
      </div>
    </TooltipProvider>
  );
}
