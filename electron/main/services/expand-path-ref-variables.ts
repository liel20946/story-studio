import { loadBulkVariableContext } from "./bulk-variables-context.js";
import { parsePathRef } from "./variable-path-ref.js";
import { resolveRunVariables } from "./bowser-stories-service.js";
import type { StoryDetail } from "./contract-types.js";

export async function expandPathRefValue(value: string): Promise<string> {
  const parsed = parsePathRef(value);
  if (!parsed) return value;
  const { files } = await loadBulkVariableContext([parsed.path]);
  if (files.length === 0) return value;
  if (files.length === 1) return files[0].content;
  return files
    .map((file) => `### ${file.relativePath}\n${file.content}`)
    .join("\n\n");
}

export async function expandPathRefVariables(
  variables?: Record<string, string>,
): Promise<Record<string, string> | undefined> {
  if (!variables) return variables;
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(variables)) {
    next[key] = await expandPathRefValue(value);
  }
  return next;
}

export async function resolveAndExpandRunVariables(
  story: StoryDetail,
  variableOverrides?: Record<string, string>,
): Promise<Record<string, string> | undefined> {
  return expandPathRefVariables(resolveRunVariables(story, variableOverrides));
}
