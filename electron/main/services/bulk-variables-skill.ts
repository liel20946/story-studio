import type { StoryDetail } from "./contract-types.js";

export const BULK_VARIABLES_SKILL = "bulk-variables";

export function buildBulkVariablesPrompt(story: StoryDetail, userDescription: string): string {
  const variableLines =
    story.variables.length > 0
      ? story.variables
          .map((v) => {
            const flag = v.secret ? " (secret — copy exactly, do not invent)" : "";
            return `- ${v.key}${flag}: ${JSON.stringify(v.value)}`;
          })
          .join("\n")
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

### Variables (current story defaults — reuse these)
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

- Include every story variable key in each run.
- Start from the story's current default values above. Only change a value when the user asked for that variation.
- Secret values (password/token/secret) must be copied exactly from the story defaults — never invent or mask them.
- Usernames, emails, and other credentials must come from the story defaults unless the user explicitly asked to vary them (e.g. different emails). When varying emails, derive from the story's real address (e.g. insert +tag before @).
- Generate as many runs as the user asked for (default 2 if unspecified).
- Labels must be short and distinct (e.g. "Admin", "Guest", "US region").
- Do not invent placeholder data like "user1@example.com" or "password123" when story defaults exist.`;
}
