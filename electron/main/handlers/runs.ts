import { ipcMain } from "../electron-api.js";
import { randomUUID } from "crypto";
import { readFile } from "fs/promises";
import * as path from "path";
import { listRuns, getRun, deleteRun, clearRuns } from "../services/run-service.js";
import { getStory } from "../services/stories-service.js";
import { startBulkRun } from "../services/codex-bulk-runner.js";
import { startAgentRun, cancelAgentRun } from "../services/agent-runner.js";
import { resolveAgentBinary } from "../services/agent-provider.js";
import { buildLastRunMap } from "../services/run-service.js";
import { formatStoryForRun } from "../services/bowser-stories-service.js";
import { getRunsDir } from "../services/paths.js";
import { getSettingsValue } from "./settings.js";

export function registerRunsHandlers(): void {
  ipcMain.handle("run:start", async (_event, params: unknown) => {
    if (
      typeof params !== "object" ||
      params === null ||
      typeof (params as Record<string, unknown>)["storyName"] !== "string"
    ) {
      throw new Error("run:start requires { storyName: string }");
    }
    const { storyName } = params as { storyName: string };
    const settings = getSettingsValue();

    const agentBinary = await resolveAgentBinary(
      settings.agentProvider,
      settings.codexBinaryPath,
      settings.claudeBinaryPath,
    );

    // Get story detail for filePath and title
    const runs = await listRuns();
    const lastRunMap = buildLastRunMap(runs);
    const story = await getStory(storyName, lastRunMap);

    const runId = randomUUID();

    // Fire and forget — results come via broadcast; caller gets runId immediately.
    startAgentRun(
      settings.agentProvider,
      runId,
      storyName,
      story.title,
      formatStoryForRun(story),
      agentBinary,
      settings.runHook,
    ).catch((err) => {
      console.error("[agent:run] unhandled run error", { runId, err: String(err) });
    });

    return { runId };
  });

  ipcMain.handle("run:bulkStart", async (_event, params: unknown) => {
    if (
      typeof params !== "object" ||
      params === null ||
      !Array.isArray((params as Record<string, unknown>)["storyNames"])
    ) {
      throw new Error("run:bulkStart requires { storyNames: string[] }");
    }
    const { storyNames, options } = params as {
      storyNames: string[];
      options?: import("../services/contract-types.js").BulkRunOptions;
    };
    if (storyNames.length === 0) {
      throw new Error("run:bulkStart requires at least one story");
    }

    const settings = getSettingsValue();
    if (settings.agentProvider === "claude-code") {
      throw new Error("Bulk runs are only supported with Codex. Switch the agent provider to Codex in Settings.");
    }

    const agentBinary = await resolveAgentBinary(
      settings.agentProvider,
      settings.codexBinaryPath,
      settings.claudeBinaryPath,
    );

    const runs = await listRuns();
    const lastRunMap = buildLastRunMap(runs);

    const bulkId = randomUUID();
    const items: { storyName: string; storyTitle: string; runId: string }[] = [];
    const bulkStories: {
      runId: string;
      storyName: string;
      storyTitle: string;
      storyContents: string;
    }[] = [];

    for (const storyName of storyNames) {
      const story = await getStory(storyName, lastRunMap);
      if (options?.storyIds?.length && story.storyId && !options.storyIds.includes(story.storyId)) {
        continue;
      }
      if (options?.tags?.length) {
        const storyTags = story.tags ?? [];
        if (!options.tags.some((t) => storyTags.includes(t))) continue;
      }
      const runId = randomUUID();
      items.push({ storyName, storyTitle: story.title, runId });
      bulkStories.push({
        runId,
        storyName,
        storyTitle: story.title,
        storyContents: formatStoryForRun(story),
      });
    }

    if (bulkStories.length === 0) {
      throw new Error("No stories matched the selected filters");
    }

    startBulkRun(bulkId, bulkStories, agentBinary, settings.runHook, options).catch((err) => {
      console.error("[codex:bulk] unhandled bulk run error", { bulkId, err: String(err) });
    });

    return { bulkId, items };
  });

  ipcMain.handle("run:cancel", async (_event, params: unknown) => {
    if (
      typeof params !== "object" ||
      params === null ||
      typeof (params as Record<string, unknown>)["runId"] !== "string"
    ) {
      throw new Error("run:cancel requires { runId: string }");
    }
    const { runId } = params as { runId: string };
    cancelAgentRun(runId);
    return { ok: true as const };
  });

  ipcMain.handle("runs:list", async () => {
    return listRuns();
  });

  ipcMain.handle("runs:get", async (_event, params: unknown) => {
    if (
      typeof params !== "object" ||
      params === null ||
      typeof (params as Record<string, unknown>)["runId"] !== "string"
    ) {
      throw new Error("runs:get requires { runId: string }");
    }
    const { runId } = params as { runId: string };
    return getRun(runId);
  });

  ipcMain.handle("runs:delete", async (_event, params: unknown) => {
    if (
      typeof params !== "object" ||
      params === null ||
      typeof (params as Record<string, unknown>)["runId"] !== "string"
    ) {
      throw new Error("runs:delete requires { runId: string }");
    }
    const { runId } = params as { runId: string };
    await deleteRun(runId);
    return { ok: true as const };
  });

  ipcMain.handle("runs:clear", async () => {
    await clearRuns();
    return { ok: true as const };
  });

  // Read a run screenshot off disk and return it as a base64 data URL. Loading
  // the PNG on demand over IPC avoids custom protocol registration races with
  // the renderer webview. One screenshot per view → payload is fine.
  ipcMain.handle("runs:screenshot", async (_event, params: unknown) => {
    const requested = (params as { path?: unknown } | null)?.path;
    if (typeof requested !== "string" || !requested) return { dataUrl: null };

    // Allowlist: only serve PNGs that resolve inside the runs directory.
    const runsDir = path.resolve(getRunsDir());
    const resolved = path.resolve(requested);
    if (resolved !== runsDir && !resolved.startsWith(runsDir + path.sep)) {
      return { dataUrl: null };
    }

    try {
      const buf = await readFile(resolved);
      return { dataUrl: `data:image/png;base64,${buf.toString("base64")}` };
    } catch {
      return { dataUrl: null };
    }
  });
}
