import { ipcMain } from "../electron-api.js";
import { randomUUID } from "crypto";
import { readFile, readdir, access } from "fs/promises";
import * as path from "path";
import { listRuns, getRun, deleteRun, clearRuns } from "../services/run-service.js";
import { getStory } from "../services/stories-service.js";
import { startBulkRun, stopBulkRun, resumeBulkRun } from "../services/bulk-runner.js";
import { startAgentRun, cancelAgentRun, listActiveRuns } from "../services/agent-runner.js";
import { resolveAgentBinary } from "../services/agent-provider.js";
import { buildLastRunMap } from "../services/run-service.js";
import { formatStoryForRun } from "../services/bowser-stories-service.js";
import { getRunsDir } from "../services/paths.js";
import { getSettingsValue } from "./settings.js";
import { getAgentRunConfig } from "../services/agent-config.js";
import { readRunMeta } from "../services/run-meta.js";
import { collectLiveScreenshotPaths } from "../services/run-artifacts.js";
import { mockRunsEnabled } from "../services/mock-runner.js";
import type { BulkRunOptions } from "../services/contract-types.js";

async function resolveScreenshotFile(requested: string): Promise<string | null> {
  const runsDir = path.resolve(getRunsDir());
  const resolved = path.resolve(requested);
  if (resolved === runsDir || resolved.startsWith(runsDir + path.sep)) {
    return resolved;
  }
  // Back-compat: steps.json may store paths relative to the run output directory.
  if (!path.isAbsolute(requested)) {
    try {
      const entries = await readdir(runsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const candidate = path.join(runsDir, entry.name, requested);
        try {
          await access(candidate);
          return candidate;
        } catch {
          // keep searching
        }
      }
    } catch {
      return null;
    }
  }
  return null;
}

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

    const agentBinary = mockRunsEnabled()
      ? "mock"
      : await resolveAgentBinary(
          settings.agentProvider,
          settings.codexBinaryPath,
          settings.claudeBinaryPath,
        );

    // Get story detail for filePath and title
    const runs = await listRuns();
    const lastRunMap = buildLastRunMap(runs);
    const story = await getStory(storyName, lastRunMap);

    const runId = randomUUID();

    const agentConfig = getAgentRunConfig(settings.agentProvider, settings);
    const runOptions = {
      computerUse:
        settings.agentProvider === "codex" && settings.codexComputerUse,
    };

    // Fire and forget — results come via broadcast; caller gets runId immediately.
    startAgentRun(
      settings.agentProvider,
      runId,
      storyName,
      story.title,
      formatStoryForRun(story),
      agentBinary,
      settings.runHook,
      agentConfig,
      runOptions,
    ).catch((err) => {
      console.error("[agent:run] unhandled run error", { runId, err: String(err) });
    });

    return {
      runId,
      agentProvider: settings.agentProvider,
      agentModel: agentConfig.model,
    };
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
      options?: BulkRunOptions;
    };
    if (storyNames.length === 0) {
      throw new Error("run:bulkStart requires at least one story");
    }

    const settings = getSettingsValue();

    const agentBinary = mockRunsEnabled()
      ? "mock"
      : await resolveAgentBinary(
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

    const agentConfig = getAgentRunConfig(settings.agentProvider, settings);
    const runOptions = {
      computerUse:
        settings.agentProvider === "codex" && settings.codexComputerUse,
      bulk: true as const,
    };

    startBulkRun(
      bulkId,
      bulkStories,
      settings.agentProvider,
      agentBinary,
      settings.runHook,
      options,
      agentConfig,
      runOptions,
    ).catch((err) => {
      console.error("[bulk] unhandled bulk run error", { bulkId, err: String(err) });
    });

    return {
      bulkId,
      items,
      agentProvider: settings.agentProvider,
      agentModel: agentConfig.model,
      maxParallel: options?.maxParallel ?? 3,
      stopCondition: options?.stopCondition?.trim() ?? "",
    };
  });

  ipcMain.handle("run:bulkStop", async (_event, params: unknown) => {
    if (
      typeof params !== "object" ||
      params === null ||
      typeof (params as Record<string, unknown>)["bulkId"] !== "string"
    ) {
      throw new Error("run:bulkStop requires { bulkId: string }");
    }
    const { bulkId, reason } = params as { bulkId: string; reason?: string };
    const snapshot = await stopBulkRun(bulkId, reason?.trim() || "Stopped by user");
    if (!snapshot) {
      throw new Error(`No active bulk run: ${bulkId}`);
    }
    return snapshot;
  });

  ipcMain.handle("run:bulkResume", async (_event, params: unknown) => {
    if (
      typeof params !== "object" ||
      params === null ||
      typeof (params as Record<string, unknown>)["bulkId"] !== "string" ||
      !Array.isArray((params as Record<string, unknown>)["storyNames"])
    ) {
      throw new Error("run:bulkResume requires { bulkId: string, storyNames: string[] }");
    }
    const { bulkId, storyNames, options } = params as {
      bulkId: string;
      storyNames: string[];
      options?: BulkRunOptions;
    };
    if (storyNames.length === 0) {
      throw new Error("run:bulkResume requires at least one story");
    }

    const settings = getSettingsValue();
    const agentBinary = mockRunsEnabled()
      ? "mock"
      : await resolveAgentBinary(
          settings.agentProvider,
          settings.codexBinaryPath,
          settings.claudeBinaryPath,
        );
    const runs = await listRuns();
    const lastRunMap = buildLastRunMap(runs);
    const agentConfig = getAgentRunConfig(settings.agentProvider, settings);
    const runOptions = {
      computerUse:
        settings.agentProvider === "codex" && settings.codexComputerUse,
      bulk: true as const,
    };

    const items: { storyName: string; storyTitle: string; runId: string }[] = [];
    const bulkStories: {
      runId: string;
      storyName: string;
      storyTitle: string;
      storyContents: string;
    }[] = [];

    for (const storyName of storyNames) {
      const story = await getStory(storyName, lastRunMap);
      const runId = randomUUID();
      items.push({ storyName, storyTitle: story.title, runId });
      bulkStories.push({
        runId,
        storyName,
        storyTitle: story.title,
        storyContents: formatStoryForRun(story),
      });
    }

    resumeBulkRun(
      bulkId,
      bulkStories,
      settings.agentProvider,
      agentBinary,
      settings.runHook,
      options,
      agentConfig,
      runOptions,
    ).catch((err) => {
      console.error("[bulk] unhandled bulk resume error", { bulkId, err: String(err) });
    });

    return {
      bulkId,
      items,
      agentProvider: settings.agentProvider,
      agentModel: agentConfig.model,
      maxParallel: options?.maxParallel ?? 3,
      stopCondition: options?.stopCondition?.trim() ?? "",
    };
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
    const cancelled = await cancelAgentRun(runId);
    if (!cancelled) {
      throw new Error(`Run is not active: ${runId}`);
    }
    return { ok: true as const };
  });

  ipcMain.handle("runs:list", async () => {
    return listRuns();
  });

  ipcMain.handle("runs:active", async () => {
    const snapshots = listActiveRuns();
    for (const snap of snapshots) {
      if (snap.storyName && snap.storyTitle) continue;
      const meta = await readRunMeta(snap.runId);
      if (!meta) continue;
      snap.storyName = snap.storyName || meta.storyName;
      snap.storyTitle = snap.storyTitle || meta.storyTitle;
      if (!snap.startedAt) snap.startedAt = meta.startedAt;
    }
    return snapshots;
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

  ipcMain.handle("runs:liveScreenshots", async (_event, params: unknown) => {
    if (
      typeof params !== "object" ||
      params === null ||
      typeof (params as Record<string, unknown>)["runId"] !== "string"
    ) {
      throw new Error("runs:liveScreenshots requires { runId: string }");
    }
    const { runId } = params as { runId: string };
    const paths = await collectLiveScreenshotPaths(runId);
    return { paths };
  });

  // Read a run screenshot off disk and return it as a base64 data URL. Loading
  // the PNG on demand over IPC avoids custom protocol registration races with
  // the renderer webview. One screenshot per view → payload is fine.
  ipcMain.handle("runs:screenshot", async (_event, params: unknown) => {
    const requested = (params as { path?: unknown } | null)?.path;
    if (typeof requested !== "string" || !requested) return { dataUrl: null };

    const resolved = await resolveScreenshotFile(requested);
    if (!resolved) return { dataUrl: null };

    try {
      const buf = await readFile(resolved);
      return { dataUrl: `data:image/png;base64,${buf.toString("base64")}` };
    } catch {
      return { dataUrl: null };
    }
  });
}
