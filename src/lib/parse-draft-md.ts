import { stripCode } from "@/components/inline-code";

export interface ParsedDraftStory {
  variables: { key: string; value: string }[];
  steps: string[];
  assertions: string[];
}

function stripFrontmatter(md: string): string {
  if (!md.startsWith("---")) return md;
  const end = md.indexOf("---", 3);
  if (end === -1) return md;
  return md.slice(end + 3).trim();
}

function extractSection(md: string, heading: string): string {
  const re = new RegExp(`## ${heading}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`, "i");
  const match = md.match(re);
  return match ? match[1].trim() : "";
}

function parseVariables(section: string): ParsedDraftStory["variables"] {
  if (!section) return [];
  const variables: ParsedDraftStory["variables"] = [];
  for (const line of section.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("-")) continue;
    const match = trimmed.match(/^-\s+`([^`]+)`:\s*(.*)$/);
    if (!match) continue;
    variables.push({
      key: stripCode(match[1]!),
      value: stripCode(match[2]!.trim()),
    });
  }
  return variables;
}

function parseSteps(section: string): string[] {
  if (!section) return [];
  const steps: string[] = [];
  for (const line of section.split("\n")) {
    const trimmed = line.trim();
    const match = trimmed.match(/^\d+\.\s+(.+)$/);
    if (match) steps.push(match[1]!.trim());
  }
  return steps;
}

function parseAssertions(section: string): string[] {
  if (!section) return [];
  const assertions: string[] = [];
  for (const line of section.split("\n")) {
    const trimmed = line.trim();
    const match = trimmed.match(/^-\s+(.+)$/);
    if (match) assertions.push(match[1]!.trim());
  }
  return assertions;
}

export function parseDraftMd(md: string): ParsedDraftStory | null {
  const content = stripFrontmatter(md).replace(/^#\s+.+\n+/, "");
  const variables = parseVariables(extractSection(content, "Variables"));
  const steps = parseSteps(extractSection(content, "Steps"));
  const assertions = parseAssertions(extractSection(content, "Assertions"));

  if (variables.length === 0 && steps.length === 0 && assertions.length === 0) {
    return null;
  }

  return { variables, steps, assertions };
}
