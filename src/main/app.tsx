import { useEffect } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { TooltipProvider, Toaster } from "@/components/ui";
import { router, queryClient } from "./router";
import { RunStoreProvider } from "../lib/run-store";
import { onSchedulesFired } from "../lib/ipc";
import { SectionsProvider } from "../lib/sections-store";
import { RecordingProvider } from "../lib/recording-store";
import { BulkRunProvider } from "../lib/bulk-run-store";
import { AgentCapabilitiesProvider } from "../lib/agent-capabilities-store";
import { useRegisterRun } from "../lib/run-store";

function ScheduleRunListener() {
  const registerRun = useRegisterRun();
  useEffect(() => {
    return onSchedulesFired(({ items, agentProvider, agentModel }) => {
      for (const item of items) {
        registerRun(item.runId, item.storyName, item.storyTitle, {
          agentProvider,
          agentModel,
        });
      }
    });
  }, [registerRun]);
  return null;
}

export function MainApp() {
  useEffect(() => {
    return window.electronAPI.on("app:navigate", (payload) => {
      const path =
        typeof payload === "object" &&
        payload !== null &&
        "path" in payload &&
        typeof (payload as { path: unknown }).path === "string"
          ? (payload as { path: string }).path
          : "/settings";
      if (path === "/settings" || path.startsWith("/settings")) {
        void router.navigate({
          to: "/settings",
          search: { section: "agent" },
        });
      } else {
        void router.navigate({ to: path });
      }
    });
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <QueryClientProvider client={queryClient}>
        <RunStoreProvider>
          <ScheduleRunListener />
          <BulkRunProvider>
            <AgentCapabilitiesProvider>
              <SectionsProvider>
              <RecordingProvider>
                <TooltipProvider>
                  <RouterProvider router={router} />
                </TooltipProvider>
                <Toaster />
              </RecordingProvider>
            </SectionsProvider>
            </AgentCapabilitiesProvider>
          </BulkRunProvider>
        </RunStoreProvider>
      </QueryClientProvider>
    </div>
  );
}
