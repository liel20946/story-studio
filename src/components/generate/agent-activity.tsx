import * as React from "react";
import { cn } from "@/lib/utils";

function normalizeStatusMessage(message: string): string {
  return message.replace(/(?:\.{3}|…)$/u, "").trim() || "Working";
}

const LABEL_FADE_MS = 140;

export function GenerateAgentActivity({
  message,
  className,
}: {
  message: string;
  className?: string;
}) {
  const label = normalizeStatusMessage(message);
  const [displayLabel, setDisplayLabel] = React.useState(label);
  const [fading, setFading] = React.useState(false);

  React.useEffect(() => {
    if (label === displayLabel) return;

    setFading(true);
    const timer = window.setTimeout(() => {
      setDisplayLabel(label);
      setFading(false);
    }, LABEL_FADE_MS);

    return () => window.clearTimeout(timer);
  }, [label, displayLabel]);

  return (
    <div className={cn("generate-agent-activity", className)} role="status" aria-live="polite">
      <span
        className={cn("generate-agent-shimmer", fading && "generate-agent-shimmer--fading")}
        aria-label={displayLabel}
      >
        {displayLabel}
      </span>
    </div>
  );
}
