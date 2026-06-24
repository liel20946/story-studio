import React from "react";
import ReactDOM from "react-dom/client";
import { SettingsView } from "./settings-view";
import "@/styles/globals.css";
import "../styles.css";
import { TooltipProvider, Toaster } from "@/components/ui";

document.title = "Settings";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <TooltipProvider>
      <SettingsView />
      <Toaster />
    </TooltipProvider>
  </React.StrictMode>,
);
