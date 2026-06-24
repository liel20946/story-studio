import * as React from "react";
import { cn } from "@/lib/utils";

const colorMap = {
  green: "bg-support-green-10 text-support-green",
  red: "bg-support-red-10 text-support-red",
  blue: "bg-support-blue-10 text-support-blue",
  yellow: "bg-support-yellow-10 text-support-yellow",
  secondary: "bg-control text-tertiary",
} as const;

export function Badge({
  color = "secondary",
  size = "medium",
  className,
  children,
}: {
  color?: keyof typeof colorMap;
  size?: "xs" | "small" | "medium";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-pill font-medium",
        size === "xs" && "px-1.5 py-px text-[10px] leading-none font-medium",
        size === "small" && "px-1 py-0 text-[10px] leading-none",
        size === "medium" && "px-2 py-0.5 text-small",
        colorMap[color],
        className,
      )}
    >
      {children}
    </span>
  );
}
