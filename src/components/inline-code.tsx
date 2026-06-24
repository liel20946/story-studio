import * as React from "react";
import { cn } from "@/lib/utils";

// Renders a markdown-ish string, turning `backtick` segments into subtle inline
// code chips. Returns inline content — place it inside a <Text> element.
// `colorMap` (chip-text → className) lets callers tint specific chips, e.g. so
// each variable name reads in its own color across steps/assertions.
export function InlineCode({
  text,
  colorMap,
}: {
  text: string;
  colorMap?: Record<string, string>;
}) {
  const parts = text.split(/(`[^`]+`)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (p.length > 1 && p.startsWith("`") && p.endsWith("`")) {
          const inner = p.slice(1, -1);
          // Variables are referenced both as bare names (`login_email`) and as
          // mustache templates (`{{login_email}}`); look up by the bare name.
          const bare = inner.replace(/^\{\{\s*|\s*\}\}$/g, "");
          const tint = colorMap?.[inner] ?? colorMap?.[bare];
          return (
            <code
              key={i}
              className={cn(
                "rounded px-1 py-px font-mono text-[0.85em] leading-none",
                tint ?? "bg-control text-secondary ring-1 ring-inset ring-separator",
              )}
            >
              {/* Show the bare variable name — never the {{ }} braces. */}
              {bare}
            </code>
          );
        }
        // Plain (non-backtick) text can still contain {{ }} placeholders; strip
        // the braces but keep the inner name so the copy reads cleanly.
        return <React.Fragment key={i}>{stripMustache(p)}</React.Fragment>;
      })}
    </>
  );
}

// Strips surrounding backticks from a value (for fields that are wholly code).
export function stripCode(s: string): string {
  return stripMustache(s.replace(/^`+|`+$/g, ""));
}

// Removes mustache braces around placeholders ({{ name }} -> name) so the
// {{ }} syntax never reaches the UI, while keeping the variable name.
export function stripMustache(s: string): string {
  return s.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, "$1");
}
