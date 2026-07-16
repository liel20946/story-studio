import type { StoryDetail } from "./contract-types.js";

export const BULK_VARIABLES_SKILL = "bulk-variables";

export function buildBulkVariablesPrompt(story: StoryDetail, userDescription: string): string {
  const variableLines =
    story.variables.length > 0
      ? story.variables.map((v) => `- ${v.key}${v.secret ? " (secret)" : ""}`).join("\n")
      : "(none defined — infer sensible placeholders from the workflow)";

  const workflowPreview = [...story.steps, ...story.assertions]
    .slice(0, 12)
    .map((line, i) => `${i + 1}. ${line}`)
    .join("\n");

  return `You are the "${BULK_VARIABLES_SKILL}" skill for Story Studio bulk runs.

Given a browser test story and a natural-language description, produce multiple variable sets so the same story can run several times with different data.

## Story
Title: ${story.title}
URL: ${story.baseUrl ?? ""}

### Variables
${variableLines}

### Workflow preview
${workflowPreview || "(no steps)"}

## User request
${userDescription.trim()}

## Output rules
Respond with ONLY valid JSON (no markdown fences, no commentary) in this shape:
{
  "runs": [
    { "label": "Short human label", "variables": { "key": "value" } }
  ]
}

- Include every story variable key in each run (use the story's default when unsure).
- Generate as many runs as the user asked for (default 2 if unspecified).
- Labels must be short and distinct (e.g. "Admin", "Guest", "US region").
- Values must be realistic test data, not placeholders like "value1".`;
}
