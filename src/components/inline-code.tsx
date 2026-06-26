import * as React from "react";
import { cn } from "@/lib/utils";

function CodeChip({
  name,
  tint,
}: {
  name: string;
  tint?: string;
}) {
  return (
    <code
      className={cn(
        "rounded px-1 py-px font-mono text-[0.85em] leading-none",
        tint ?? "bg-control text-secondary ring-1 ring-inset ring-separator",
      )}
    >
      {name}
    </code>
  );
}

// Story workflow lines reference variables as `{{name}}` or as a quoted name in
// Fill/Type steps (e.g. with "login_email" or "{{login_email}}"). Highlight
// all of these when colorMap matches.
const PLAIN_TOKEN_RE = /\{\{\s*([^}]+?)\s*\}\}|"([^"]+)"/g;

function variableNameFromQuoted(quoted: string): string | null {
  const mustache = quoted.match(/^\{\{\s*([^}]+?)\s*\}\}$/);
  return mustache ? mustache[1]!.trim() : null;
}

function renderPlainWithVariables(
  text: string,
  colorMap?: Record<string, string>,
  keyPrefix = "plain",
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let tokenIndex = 0;

  for (const match of text.matchAll(PLAIN_TOKEN_RE)) {
    const full = match[0];
    const index = match.index ?? 0;
    const mustacheName = match[1]?.trim();
    const quotedName = match[2];
    const quotedMustacheName = quotedName
      ? variableNameFromQuoted(quotedName)
      : null;
    const variableName =
      mustacheName ?? quotedMustacheName ?? quotedName ?? null;
    const isVariable =
      mustacheName !== undefined ||
      quotedMustacheName !== null ||
      (quotedName !== undefined && colorMap?.[quotedName] !== undefined);

    if (index > lastIndex) {
      nodes.push(text.slice(lastIndex, index));
    }

    if (isVariable && variableName) {
      const tint = colorMap?.[variableName];
      nodes.push(
        <CodeChip
          key={`${keyPrefix}-${tokenIndex++}`}
          name={variableName}
          tint={tint}
        />,
      );
    } else if (quotedName !== undefined) {
      nodes.push(`"${quotedName}"`);
    } else {
      nodes.push(full);
    }

    lastIndex = index + full.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

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
          return <CodeChip key={i} name={bare} tint={tint} />;
        }
        return (
          <React.Fragment key={i}>
            {renderPlainWithVariables(p, colorMap, `seg-${i}`)}
          </React.Fragment>
        );
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
