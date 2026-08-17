import type { StoryDetail } from "./contract-types.js";
import { parsePathRef, storyPathRefVariables } from "./variable-path-ref.js";

export const BULK_VARIABLES_SKILL = "bulk-variables";

export function buildBulkVariablesPrompt(
  story: StoryDetail,
  userDescription: string,
  attachedContextSection = "",
): string {
  const variableLines =
    story.variables.length > 0
      ? story.variables
          .map((v) => {
            const pathRef = parsePathRef(v.value);
            if (pathRef) {
              return `- ${v.key} (${pathRef.kind} variable): fill from attached ${pathRef.kind}s with a @${pathRef.kind}: ref. Do not copy the story default path.`;
            }
            const flag = v.secret ? " (secret — copy exactly, do not invent)" : "";
            return `- ${v.key}${flag}: ${JSON.stringify(v.value)}`;
          })
          .join("\n")
      : "(none defined — infer sensible placeholders from the workflow)";

  const workflowPreview = [...story.steps, ...story.assertions]
    .slice(0, 12)
    .map((line, i) => `${i + 1}. ${line}`)
    .join("\n");

  const contextBlock = attachedContextSection.trim()
    ? `\n${attachedContextSection.trim()}\n`
    : "";

  const pathRefs = storyPathRefVariables(story.variables);
  const pathRefRule =
    pathRefs.length > 0
      ? `- File/folder story variables (${pathRefs
          .map((ref) => `${ref.key}=${ref.kind}`)
          .join(", ")}): when files/folders are attached, set those keys to @file: or @folder: refs (e.g. "@file:attachments/promo.html"). Story Studio substitutes the real bytes. Never copy the story default path and never invent replacement HTML.`
      : `- When attached files/folders are provided, do NOT inline file contents in JSON. Set payload variables (HTML/JSON/text/CSV paste body) to a file ref: \`"@file:attachments/promo.html"\`. Story Studio substitutes the real bytes. Never invent replacement HTML.`;

  return `You are the "${BULK_VARIABLES_SKILL}" skill for Story Studio bulk runs.

Given a browser test story and a natural-language description, produce multiple variable sets so the same story can run several times with different data.

## Story
Title: ${story.title}
URL: ${story.baseUrl ?? ""}

### Variables (current story defaults — reuse these)
${variableLines}

### Workflow preview
${workflowPreview || "(no steps)"}
${contextBlock}
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
${pathRefRule}
- Prefer one attached file per run when the user asks to vary by file; label runs after the file name.
- Generate as many runs as the user asked for (default 2 if unspecified; if they attach N files and ask for one per file, generate N runs).
- Labels must be short and distinct (e.g. "Admin", "Guest", "welcome.html").
- Do not invent placeholder data like "user1@example.com" or "password123" when story defaults exist.`;
}
