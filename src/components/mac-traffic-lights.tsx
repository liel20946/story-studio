import type { ReactNode, SVGProps } from "react";
import { closeWindow, minimizeWindow, toggleMaximizeWindow } from "@/lib/window-controls";

function isMacWindowChrome(): boolean {
  return document.documentElement.classList.contains("mac-window-chrome");
}

function TrafficLightIcon({
  kind,
  ...props
}: { kind: "close" | "minimize" | "maximize" } & SVGProps<SVGSVGElement>) {
  if (kind === "close") {
    return (
      <svg viewBox="0 0 8 8" width="8" height="8" aria-hidden {...props}>
        <path
          d="M2 2 6 6M6 2 2 6"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  if (kind === "minimize") {
    return (
      <svg viewBox="0 0 8 8" width="8" height="8" aria-hidden {...props}>
        <path
          d="M1.75 4h4.5"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 8 8" width="8" height="8" aria-hidden {...props}>
      <path
        d="M2.5 6.5V2.5H6.5"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M2.5 6.5 6.5 2.5"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function MacTitlebarRow({ children }: { children?: ReactNode }) {
  if (!isMacWindowChrome()) {
    return <div className="drag-region sidebar-titlebar-spacer" aria-hidden />;
  }

  return (
    <div className="sidebar-titlebar-row drag-region flex shrink-0 items-center">
      <div className="mac-traffic-lights no-drag">
        <button
          type="button"
          className="mac-traffic-light mac-traffic-light--close"
          aria-label="Close"
          onClick={() => void closeWindow()}
        >
          <TrafficLightIcon kind="close" className="mac-traffic-light-icon" />
        </button>
        <button
          type="button"
          className="mac-traffic-light mac-traffic-light--minimize"
          aria-label="Minimize"
          onClick={() => void minimizeWindow()}
        >
          <TrafficLightIcon kind="minimize" className="mac-traffic-light-icon" />
        </button>
        <button
          type="button"
          className="mac-traffic-light mac-traffic-light--maximize"
          aria-label="Zoom"
          onClick={() => void toggleMaximizeWindow()}
        >
          <TrafficLightIcon kind="maximize" className="mac-traffic-light-icon" />
        </button>
      </div>
      {children}
    </div>
  );
}
