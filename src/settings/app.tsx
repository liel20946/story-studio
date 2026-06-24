import { TooltipProvider, Toaster } from "@/components/ui";
import { SettingsView } from "./settings-view";
import { useTheme } from "../lib/theme";

export function SettingsApp() {
  useTheme();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TooltipProvider>
        <SettingsView />
        <Toaster />
      </TooltipProvider>
    </div>
  );
}
