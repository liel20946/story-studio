import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { router, queryClient } from "./router";
import "@/styles/globals.css";
import "../styles.css";
import { QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider, Toaster } from "@/components/ui";
import { RunStoreProvider } from "../lib/run-store";
import { SectionsProvider } from "../lib/sections-store";
import { RecordingProvider } from "../lib/recording-store";
import { BulkRunProvider } from "../lib/bulk-run-store";

document.title = "Story Studio";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
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
  </React.StrictMode>,
);

if (import.meta.hot) {
  import.meta.hot.accept();
}
