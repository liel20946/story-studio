import { useEffect } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { TooltipProvider, Toaster } from "@/components/ui";
import { router, queryClient } from "./router";
import { RunStoreProvider } from "../lib/run-store";
import { SectionsProvider } from "../lib/sections-store";
import { RecordingProvider } from "../lib/recording-store";
import { BulkRunProvider } from "../lib/bulk-run-store";

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
      void router.navigate({ to: path });
    });
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <QueryClientProvider client={queryClient}>
        <RunStoreProvider>
          <BulkRunProvider>
            <SectionsProvider>
              <RecordingProvider>
                <TooltipProvider>
                  <RouterProvider router={router} />
                </TooltipProvider>
                <Toaster />
              </RecordingProvider>
            </SectionsProvider>
          </BulkRunProvider>
        </RunStoreProvider>
      </QueryClientProvider>
    </div>
  );
}
