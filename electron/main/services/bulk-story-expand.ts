import { randomUUID } from "crypto";
import type { BulkStoryRunRequest, BulkRunOptions, BulkVariableRun } from "./contract-types.js";
import type { StoryDetail } from "./contract-types.js";
import { formatStoryForRun } from "./bowser-stories-service.js";
import { resolveAndExpandRunVariables } from "./expand-path-ref-variables.js";
import type { BulkStoryInput } from "./bulk-runner.js";

export interface BulkLaunchItem {
  storyName: string;
  storyTitle: string;
  runId: string;
  runLabel?: string;
  variableOverrides?: Record<string, string>;
}

export function expandBulkRunRequests(
  storyNames: string[],
  variablePlans?: Record<string, BulkVariableRun[]>,
): BulkStoryRunRequest[] {
  const requests: BulkStoryRunRequest[] = [];
  for (const storyName of storyNames) {
    const plans = variablePlans?.[storyName];
    if (plans?.length) {
      for (const plan of plans) {
        requests.push({
          storyName,
          variableOverrides: plan.variables,
          runLabel: plan.label,
        });
      }
    } else {
      requests.push({ storyName });
    }
  }
  return requests;
}

export async function buildBulkStoryInputs(
  requests: BulkStoryRunRequest[],
  storiesByName: Map<string, StoryDetail>,
  options?: BulkRunOptions,
): Promise<{ items: BulkLaunchItem[]; bulkStories: BulkStoryInput[] }> {
  const items: BulkLaunchItem[] = [];
  const bulkStories: BulkStoryInput[] = [];

  for (const request of requests) {
    const story = storiesByName.get(request.storyName);
    if (!story) continue;
    if (
      options?.storyIds?.length &&
      story.storyId &&
      !options.storyIds.includes(story.storyId)
    ) {
      continue;
    }

    const runId = randomUUID();
    const hasLabel = Boolean(request.runLabel?.trim());
    const storyTitle =
      hasLabel && requests.filter((r) => r.storyName === request.storyName).length > 1
        ? `${story.title} (${request.runLabel})`
        : story.title;

    const variableOverrides = await resolveAndExpandRunVariables(
      story,
      request.variableOverrides,
    );

    items.push({
      storyName: request.storyName,
      storyTitle,
      runId,
      runLabel: request.runLabel,
      variableOverrides,
    });
    bulkStories.push({
      runId,
      storyName: request.storyName,
      storyTitle,
      storyContents: formatStoryForRun(story, variableOverrides),
      variableOverrides,
    });
  }

  return { items, bulkStories };
}
