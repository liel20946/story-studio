import type { RunEventKind } from "./contract-types.js";

export interface ClassifiedMcpTool {
  kind: RunEventKind;
  label: string;
  detail?: string;
}

const DETAIL_MAX_LEN = 120;

function truncateDetail(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= DETAIL_MAX_LEN) return trimmed;
  return `${trimmed.slice(0, DETAIL_MAX_LEN - 1)}…`;
}

function titleCaseIdentifier(value: string): string {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function humanizeElement(value: string): string {
  const trimmed = value.trim();

  const roleMatch = trimmed.match(
    /^(button|link|textbox|input|select|checkbox|radio)\s*:\s*(.+)$/i,
  );
  if (roleMatch) {
    const [, role, name] = roleMatch;
    const suffix = /^(textbox|input)$/i.test(role) ? "field" : role.toLowerCase();
    return truncateDetail(`${name.trim()} ${suffix}`);
  }

  const attributeMatch = trimmed.match(
    /^(?:input|textarea|select)?[^\[]*\[(name|type|placeholder|aria-label)\s*=\s*(?:["']([^"']+)["']|([^\]\s]+))\]/i,
  );
  if (attributeMatch) {
    const [, attribute, quotedName, unquotedName] = attributeMatch;
    const rawName = quotedName ?? unquotedName;
    const name =
      attribute.toLowerCase() === "type" && rawName.toLowerCase() === "password"
        ? "Password"
        : attribute.toLowerCase() === "type" && rawName.toLowerCase() === "email"
          ? "Email"
          : titleCaseIdentifier(rawName);
    const suffix = /^select/i.test(trimmed) ? "select" : "field";
    return truncateDetail(`${name} ${suffix}`);
  }

  const textMatch = trimmed.match(
    /^(button|a|link).*?(?:has-text|text)\s*\(\s*["']([^"']+)["']\s*\)/i,
  );
  if (textMatch) {
    const [, element, name] = textMatch;
    return truncateDetail(`${name} ${/^(a|link)$/i.test(element) ? "link" : "button"}`);
  }

  if (/^input\b/i.test(trimmed)) return "Input field";
  if (/^textarea\b/i.test(trimmed)) return "Text area";
  if (/^select\b/i.test(trimmed)) return "Select";
  if (/^button\b/i.test(trimmed)) return "Button";

  return truncateDetail(trimmed);
}

function bareToolName(toolName: string): string {
  return toolName
    .replace(/^mcp__playwright__/, "")
    .replace(/^playwright__browser[-_]?/, "")
    .replace(/^browser[-_]?/, "")
    .toLowerCase();
}

function isUnsafeCodeTool(toolName: string, args: Record<string, unknown>): boolean {
  const bare = bareToolName(toolName);
  if (/run_code(_unsafe)?/.test(bare)) return true;
  return typeof args["code"] === "string" || typeof args["function"] === "string";
}

function extractQuotedCallArgument(code: string, callPattern: RegExp): string | undefined {
  const match = callPattern.exec(code);
  if (!match) return undefined;

  let index = match.index + match[0].length;
  while (index < code.length && /\s/.test(code[index])) index += 1;
  const quote = code[index];
  if (quote !== "'" && quote !== '"' && quote !== "`") return undefined;

  let value = "";
  for (index += 1; index < code.length; index += 1) {
    const character = code[index];
    if (character === "\\") {
      const next = code[index + 1];
      if (next !== undefined) {
        value += next;
        index += 1;
      }
      continue;
    }
    if (character === quote) return value;
    value += character;
  }
  return undefined;
}

function extractLocatorDetail(code: string): string | undefined {
  const accessiblePatterns = [
    /getByRole\(\s*['"](\w+)['"]\s*,\s*\{\s*name:\s*['"]([^'"]+)['"]/i,
    /getBy(?:Text|Label|Placeholder|AltText|Title|TestId)\(\s*['"]([^'"]+)['"]/i,
  ];
  for (const pattern of accessiblePatterns) {
    const match = code.match(pattern);
    if (!match) continue;
    if (match.length >= 3) {
      return humanizeElement(`${match[1]}: ${match[2]}`);
    }
    return humanizeElement(match[1]);
  }
  // A selector commonly contains quotes of its own, for example
  // locator('input[type="email"]'). A regex character class stops at that
  // nested quote and produced details such as `input[type=`. Parse the outer
  // JavaScript string instead.
  const locator = extractQuotedCallArgument(code, /\blocator\s*\(/i);
  if (locator) return humanizeElement(locator);

  const fallbackPatterns = [
    /page\.goto\(\s*['"]([^'"]+)['"]/i,
    /\.selectOption\(\s*['"]([^'"]+)['"]/i,
    /\.press\(\s*['"]([^'"]+)['"]/i,
  ];
  for (const pattern of fallbackPatterns) {
    const match = code.match(pattern);
    if (match) return humanizeElement(match[1]);
  }
  return undefined;
}

function classifyUnsafeCode(code: string): ClassifiedMcpTool {
  const normalized = code.trim();

  if (
    /\.(click|dblclick|tap|check|uncheck)\s*\(/i.test(normalized) ||
    /element\.click\s*\(/i.test(normalized) ||
    /evaluate\(\s*\(?\s*\w+\s*\)?\s*=>\s*\w+\.click\s*\(/i.test(normalized)
  ) {
    return {
      kind: "click",
      label: "Click",
      detail: extractLocatorDetail(normalized),
    };
  }

  if (/\.(fill|type|pressSequentially)\s*\(/i.test(normalized)) {
    return {
      kind: "type",
      label: "Fill",
      detail: extractLocatorDetail(normalized),
    };
  }

  if (/\.selectOption\s*\(/i.test(normalized)) {
    return {
      kind: "click",
      label: "Select",
      detail: extractLocatorDetail(normalized),
    };
  }

  if (/\.press\s*\(/i.test(normalized)) {
    return {
      kind: "click",
      label: "Press",
      detail: extractLocatorDetail(normalized),
    };
  }

  if (/page\.goto\s*\(|\.reload\s*\(/i.test(normalized)) {
    return {
      kind: "navigate",
      label: "Navigate",
      detail: extractLocatorDetail(normalized),
    };
  }

  if (
    /waitForTimeout\s*\(/i.test(normalized) ||
    /waitForURL\s*\(/i.test(normalized) ||
    /waitForSelector\s*\(/i.test(normalized) ||
    /\.waitFor\s*\(/i.test(normalized)
  ) {
    return {
      kind: "wait",
      label: "Wait",
      detail: extractLocatorDetail(normalized),
    };
  }

  if (/\.hover\s*\(/i.test(normalized)) {
    return {
      kind: "click",
      label: "Hover",
      detail: extractLocatorDetail(normalized),
    };
  }

  return {
    kind: "evaluate",
    label: "Thinking",
    detail: undefined,
  };
}

function classifyNamedTool(toolName: string): ClassifiedMcpTool | null {
  const bare = bareToolName(toolName);
  if (bare.includes("navigate") || bare.includes("goto")) {
    return { kind: "navigate", label: "Navigate" };
  }
  if (bare.includes("click") || bare.includes("press") || bare.includes("select")) {
    return { kind: "click", label: labelForClickTool(bare) };
  }
  if (bare.includes("type") || bare.includes("fill")) {
    return { kind: "type", label: "Fill" };
  }
  if (bare.includes("snapshot")) {
    return { kind: "evaluate", label: "Thinking" };
  }
  if (bare.includes("screenshot")) {
    return { kind: "evaluate", label: "Thinking" };
  }
  if (bare.includes("wait")) {
    return { kind: "wait", label: "Wait" };
  }
  if (bare.includes("evaluate")) {
    return { kind: "evaluate", label: "Thinking" };
  }
  return null;
}

function labelForClickTool(bare: string): string {
  if (bare.includes("press")) return "Press";
  if (bare.includes("select")) return "Select";
  if (bare.includes("hover")) return "Hover";
  return "Click";
}

function extractNamedToolDetail(
  args: Record<string, unknown>,
  kind?: RunEventKind,
): string | undefined {
  if (typeof args["url"] === "string") return truncateDetail(args["url"]);
  if (typeof args["element"] === "string") return humanizeElement(args["element"]);
  if (typeof args["selector"] === "string") return humanizeElement(args["selector"]);
  if (typeof args["key"] === "string") return truncateDetail(args["key"]);
  if (Array.isArray(args["fields"])) {
    const names = (args["fields"] as Array<Record<string, unknown>>)
      .map((f) => (f["name"] ?? f["ref"]) as string | undefined)
      .filter((n): n is string => typeof n === "string");
    if (names.length) return truncateDetail(names.map(humanizeElement).join(", "));
  }
  // Typed values may contain credentials. The target element is useful; the value is not.
  if (kind !== "type" && typeof args["text"] === "string") {
    return truncateDetail(args["text"]);
  }
  return undefined;
}

export function classifyMcpTool(
  toolName: string,
  args: Record<string, unknown> = {},
): ClassifiedMcpTool {
  if (isUnsafeCodeTool(toolName, args)) {
    const code = String(args["code"] ?? args["function"] ?? "");
    return classifyUnsafeCode(code);
  }

  const named = classifyNamedTool(toolName);
  if (named) {
    return {
      ...named,
      detail: extractNamedToolDetail(args, named.kind),
    };
  }

  const bare = bareToolName(toolName);
  return {
    kind: "tool",
    label: bare.charAt(0).toUpperCase() + bare.slice(1).replace(/[-_]/g, " "),
    detail: extractNamedToolDetail(args),
  };
}
