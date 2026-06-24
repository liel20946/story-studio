import * as React from "react";
import { cn } from "@/lib/utils";

const variantMap = {
  regular: "text-regular",
  strong: "text-strong font-medium",
  small: "text-small",
  "small-strong": "text-small font-medium",
  large: "text-large",
  "large-strong": "text-large font-medium",
  "extra-large": "text-extra-large",
  "extra-large-strong": "text-extra-large font-medium",
  heading1: "text-heading1 font-semibold",
  heading2: "text-heading2 font-semibold",
  mini: "text-mini",
  "mini-strong": "text-mini font-medium",
  mono: "font-mono text-regular",
  "mono-strong": "font-mono text-regular font-semibold",
  "small-mono": "font-mono text-small",
  "micro-mono": "font-mono text-micro",
} as const;

const colorMap = {
  primary: "text-primary",
  secondary: "text-secondary",
  tertiary: "text-tertiary",
  quaternary: "text-quaternary",
  "accent-contrast": "text-accent-contrast",
  link: "text-[var(--color-text-link)]",
} as const;

export function Text({
  variant = "regular",
  color = "primary",
  truncate,
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & {
  variant?: keyof typeof variantMap;
  color?: keyof typeof colorMap;
  truncate?: boolean;
}) {
  return (
    <span
      className={cn(
        variantMap[variant],
        colorMap[color],
        truncate && "truncate",
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
