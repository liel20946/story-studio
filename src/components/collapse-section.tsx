import * as React from "react";
import { cn } from "@/lib/utils";

/** Smooth height expand/collapse via CSS grid row transition. */
export function CollapseSection({
  open,
  children,
  className,
}: {
  open: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("collapse-section", open && "collapse-section--open", className)}
      aria-hidden={!open}
    >
      <div className="collapse-section-inner">{children}</div>
    </div>
  );
}
