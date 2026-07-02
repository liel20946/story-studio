import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "@/styles/globals.css";
import "./styles.css";

const params = new URLSearchParams(window.location.search);
const isSettings = params.get("window") === "settings";

async function bootstrap() {
  const rootElement = document.getElementById("root");
  if (!rootElement) throw new Error("Root element not found");

  if (isSettings) {
    document.title = "Settings";
    const { SettingsApp } = await import("./settings/app");
    ReactDOM.createRoot(rootElement).render(
      <React.StrictMode>
        <SettingsApp />
      </React.StrictMode>,
    );
  } else {
    document.title = "Story Studio";
    const { MainApp } = await import("./main/app");
    ReactDOM.createRoot(rootElement).render(
      <React.StrictMode>
        <MainApp />
      </React.StrictMode>,
    );
  }
}

void bootstrap();
