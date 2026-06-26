import * as fs from "fs/promises";
import * as path from "path";
import { getRunsDir } from "./paths.js";
import { startAgentRun } from "./agent-runner.js";
import type { AgentProvider, BulkRunOptions } from "./contract-types.js";
import type { AgentRunConfig } from "./agent-config.js";

export interface BulkStoryInput {
  runId: string;
  storyName: string;
  storyTitle: string;
  storyContents: string;
}

/**
 * Bulk runs start one independent agent process per story. Run and Playwright
 * slots queue excess stories automatically — no orchestrator subagents.
 */
export async function startBulkRun(
  bulkId: string,
  stories: BulkStoryInput[],
  provider: AgentProvider,
  agentBinary: string,
  runHook?: string,
  options?: BulkRunOptions,
  agentConfig?: AgentRunConfig,
): Promise<void> {
  const runsDir = getRunsDir();
  const bulkRoot = path.join(runsDir, `bulk-${bulkId}`);
  await fs.mkdir(bulkRoot, { recursive: true });
  await fs.writeFile(
    path.join(bulkRoot, "run-plan.json"),
    JSON.stringify(
      {
        bulkId,
        provider,
        startedAt: Date.now(),
        storyCount: stories.length,
        options: options ?? {},
        stories: stories.map((s) => ({
          runId: s.runId,
          storyName: s.storyName,
          storyTitle: s.storyTitle,
        })),
      },
      null,
      2,
    ),
    "utf-8",
  );

  console.log("[bulk]", {
    bulkId,
    provider,
    storyCount: stories.length,
    agentBinary,
  });

  for (const story of stories) {
    startAgentRun(
      provider,
      story.runId,
      story.storyName,
      story.storyTitle,
      story.storyContents,
      agentBinary,
      runHook,
      agentConfig,
    ).catch((err) => {
      console.error("[bulk] child run error", {
        bulkId,
        runId: story.runId,
        err: String(err),
      });
    });
  }
}
