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
import {
  buildBulkStoryInputs,
  expandBulkRunRequests,
} from "../services/bulk-story-expand.js";
import { getRunsDir } from "../services/paths.js";
import { getSettingsValue } from "./settings.js";
import { getAgentRunConfig } from "../services/agent-config.js";
import { readRunMeta } from "../services/run-meta.js";
import { collectLiveScreenshotPaths } from "../services/run-artifacts.js";
import { buildLiveTimeline } from "../services/run-timeline.js";
import { mockRunsEnabled } from "../services/mock-runner.js";
import type { BulkRunOptions } from "../services/contract-types.js";

// Playwright MCP screenshots are saved as JPEG by default even when the
// requested filename ends in ".png" (quality-compressed unless `raw: true`
// is set), so the file extension can't be trusted for the MIME type. Sniff
// the leading magic bytes instead — otherwise an <img data:image/png;...>
// tag pointed at JPEG bytes silently fails to decode and renders nothing.
function detectImageMime(buf: Buffer): string {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return "image/webp";
  }
  if (buf.length >= 6 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
    return "image/gif";
  }
  return "image/png";
}

// While a run is live, the screenshot file can show up in a directory
// listing (and get polled by the renderer) before the write to disk has
// finished flushing — reading it then yields a truncated buffer that looks
// fine to `detectImageMime` but fails to decode in <img>. Check for the
// format's end-of-file marker so we can tell "still being written" apart
// from "genuinely broken" and retry instead of caching a blank frame.
function isLikelyCompleteImage(buf: Buffer, mime: string): boolean {
  if (buf.length === 0) return false;
  if (mime === "image/jpeg") {
    return buf[buf.length - 2] === 0xff && buf[buf.length - 1] === 0xd9;
  }
  if (mime === "image/png") {
    if (buf.length < 8) return false;
    const tail = buf.subarray(buf.length - 8, buf.length - 4);
    return (
      tail[0] === 0x49 && tail[1] === 0x45 && tail[2] === 0x4e && tail[3] === 0x44
    );
  }
  // WebP/GIF screenshots aren't produced by our capture path today — trust the read.
  return true;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Backoff while waiting for an in-flight screenshot write to land — short
// enough to stay invisible against the renderer's 750ms live-screenshot poll.
const SCREENSHOT_READ_RETRY_DELAYS_MS = [30, 60, 120, 240];

async function readScreenshotFile(
  resolved: string,
): Promise<{ buf: Buffer; mime: string } | null> {
  for (let attempt = 0; ; attempt++) {
    let buf: Buffer;
    try {
      buf = await readFile(resolved);
    } catch {
      if (attempt >= SCREENSHOT_READ_RETRY_DELAYS_MS.length) return null;
      await delay(SCREENSHOT_READ_RETRY_DELAYS_MS[attempt]);
      continue;
    }
    const mime = detectImageMime(buf);
    if (isLikelyCompleteImage(buf, mime) || attempt >= SCREENSHOT_READ_RETRY_DELAYS_MS.length) {
      return { buf, mime };
    }
    await delay(SCREENSHOT_READ_RETRY_DELAYS_MS[attempt]);
  }
}

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
    const storyMap = new Map<string, Awaited<ReturnType<typeof getStory>>>();
    for (const storyName of storyNames) {
      if (!storyMap.has(storyName)) {
        storyMap.set(storyName, await getStory(storyName, lastRunMap));
      }
    }

    const runRequests =
      options?.resumeItems?.length
        ? options.resumeItems
        : expandBulkRunRequests(storyNames, options?.variablePlans);

    const { items, bulkStories } = buildBulkStoryInputs(
      runRequests,
      storyMap,
      options,
    );

    if (bulkStories.length === 0) {
      throw new Error("No stories matched the selected filters");
    }

    const agentConfig = getAgentRunConfig(settings.agentProvider, settings);

    startBulkRun(
      bulkId,
      bulkStories,
      settings.agentProvider,
      agentBinary,
      settings.runHook,
      options,
      agentConfig,
    ).catch((err) => {
      console.error("[bulk] unhandled bulk run error", { bulkId, err: String(err) });
    });

    return {
      bulkId,
      items,
      agentProvider: settings.agentProvider,
      agentModel: agentConfig.model,
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
    if (typeof params !== "object" || params === null) {
      throw new Error("run:bulkResume requires { bulkId: string }");
    }
    const record = params as Record<string, unknown>;
    if (typeof record["bulkId"] !== "string") {
      throw new Error("run:bulkResume requires { bulkId: string }");
    }
    const { bulkId, storyNames, options } = params as {
      bulkId: string;
      storyNames?: string[];
      options?: BulkRunOptions;
    };

    const resumeItems =
      options?.resumeItems ??
      (Array.isArray(storyNames) && storyNames.length > 0
        ? storyNames.map((storyName) => ({ storyName }))
        : null);
    if (!resumeItems?.length) {
      throw new Error("run:bulkResume requires resume items");
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

    const storyMap = new Map<string, Awaited<ReturnType<typeof getStory>>>();
    for (const request of resumeItems) {
      if (!storyMap.has(request.storyName)) {
        storyMap.set(request.storyName, await getStory(request.storyName, lastRunMap));
      }
    }

    const { items, bulkStories } = buildBulkStoryInputs(resumeItems, storyMap, options);

    resumeBulkRun(
      bulkId,
      bulkStories,
      settings.agentProvider,
      agentBinary,
      settings.runHook,
      options,
      agentConfig,
    ).catch((err) => {
      console.error("[bulk] unhandled bulk resume error", { bulkId, err: String(err) });
    });

    return {
      bulkId,
      items,
      agentProvider: settings.agentProvider,
      agentModel: agentConfig.model,
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

  ipcMain.handle("runs:liveTimeline", async (_event, params: unknown) => {
    if (
      typeof params !== "object" ||
      params === null ||
      typeof (params as Record<string, unknown>)["runId"] !== "string"
    ) {
      throw new Error("runs:liveTimeline requires { runId: string }");
    }
    const { runId } = params as { runId: string };
    const events = await buildLiveTimeline(runId);
    return { events };
  });

  // Read a run screenshot off disk and return it as a base64 data URL. Loading
  // the image on demand over IPC avoids custom protocol registration races
  // with the renderer webview. One screenshot per view → payload is fine.
  ipcMain.handle("runs:screenshot", async (_event, params: unknown) => {
    const requested = (params as { path?: unknown } | null)?.path;
    if (typeof requested !== "string" || !requested) return { dataUrl: null };

    const resolved = await resolveScreenshotFile(requested);
    if (!resolved) return { dataUrl: null };

    const result = await readScreenshotFile(resolved);
    if (!result) return { dataUrl: null };
    return { dataUrl: `data:${result.mime};base64,${result.buf.toString("base64")}` };
  });
}
