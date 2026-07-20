import * as fs from "fs/promises";
import * as path from "path";
import { spawn, type ChildProcess } from "child_process";
import { broadcast } from "../broadcast.js";
import { killDetachedAgentProcess } from "./agent-process-kill.js";
import type {
  RunEvent,
  RunEventKind,
  RunResult,
  RunRecord,
  AssertionResult,
  RunStatus,
  ActiveRunSnapshot,
} from "./contract-types.js";
import { saveRun, buildScreenshotUrl } from "./run-service.js";
import { writeRunMeta, deleteRunMeta, withRunVariables } from "./run-meta.js";
import { getRunsDir } from "./paths.js";
import { buildRunStoryPlaybook, buildRunPromptSuffix } from "./story-skill.js";
import { getSettingsValue } from "../handlers/settings.js";
import {
  ensureRunOutputDir,
  getHeroScreenshotPath,
  getRunStepsPath,
  getRunScreenshotsDir,
  enrichRunResult,
} from "./run-artifacts.js";
import {
  deletePersistedRunEvents,
  deleteRunPid,
  ensureActionTimeline,
  flushPersistRunEvents,
  schedulePersistRunEvents,
  writeRunPid,
} from "./run-events-persist.js";
import {
  acquirePlaywrightSlot,
  releasePlaywrightSlot,
} from "./playwright-slots.js";
import { ensurePlaywrightReady } from "./playwright-preflight.js";
import { RUN_OUTPUT_SCHEMA } from "./codex-runner.js";
import {
  acquireRunSlot,
  isRunSlotBusy,
  releaseRunSlot,
} from "./run-slots.js";
import {
  DEFAULT_CLAUDE_EFFORT,
  DEFAULT_CLAUDE_MODEL,
  type AgentRunConfig,
} from "./agent-config.js";
import {
  playwrightMcpSecretEnv,
  writeClaudeMcpConfigFile,
} from "./browser-mcp-config.js";
import {
  markRunCancelled,
  settleRunningEvents,
} from "./run-event-settle.js";
import { buildClaudeSpawnEnv } from "./agent-spawn-env.js";
import { classifyMcpTool } from "./mcp-tool-event.js";

interface RunState {
  runId: string;
  storyName: string;
  storyTitle: string;
  startedAt: number;
  agentProvider: "claude-code";
  agentModel: string;
  events: RunEvent[];
  process: ChildProcess | null;
  cancelled: boolean;
  seq: number;
  itemSeq: Map<string, number>;
  queued: boolean;
  variableOverrides?: Record<string, string>;
}

const _runs = new Map<string, RunState>();

export function listActiveClaudeRuns(): ActiveRunSnapshot[] {
  return Array.from(_runs.values()).map((state) => ({
    runId: state.runId,
    storyName: state.storyName,
    storyTitle: state.storyTitle,
    startedAt: state.startedAt,
    agentProvider: state.agentProvider,
    agentModel: state.agentModel,
    events: [...state.events],
    variableOverrides: state.variableOverrides,
    queued: state.queued,
  }));
}

function syncRunTimeline(runId: string, events: RunEvent[]): void {
  schedulePersistRunEvents(runId, events);
}

function resolveStartingRow(events: RunEvent[], runId: string): void {
  for (const e of events) {
    if (e.kind === "status" && e.status === "running") {
      e.status = "ok";
      broadcast("run:event", { ...e });
    }
  }
  syncRunTimeline(runId, events);
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

function isPlaywrightMcpTool(toolName: string): boolean {
  return (
    toolName.startsWith("mcp__playwright__") ||
    toolName.startsWith("playwright__") ||
    /^browser[-_]/i.test(toolName)
  );
}

async function readResultJson(resultPath: string): Promise<Record<string, unknown> | null> {
  try {
    const data = await fs.readFile(resultPath, "utf-8");
    return JSON.parse(data) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function buildErrorResult(
  runId: string,
  storyName: string,
  storyTitle: string,
  startedAt: number,
  error: string,
  screenshotPath: string,
  agentProvider: "claude-code" = "claude-code",
  agentModel?: string,
): RunResult {
  return {
    runId,
    storyName,
    storyTitle,
    status: "error",
    summary: "",
    assertions: [],
    screenshotPath,
    screenshotUrl: buildScreenshotUrl(runId, screenshotPath),
    startedAt,
    finishedAt: Date.now(),
    error,
    agentProvider,
    agentModel,
  };
}

async function finalizeRun(result: RunResult, events: RunEvent[]): Promise<RunResult> {
  settleRunningEvents(events, result.status);
  const withSteps = await ensureActionTimeline(result.runId, events);
  events.length = 0;
  events.push(...withSteps);
  await flushPersistRunEvents(result.runId, events);
  const withVars = await withRunVariables(result);
  const enriched = await enrichRunResult(withVars);
  const record: RunRecord = { ...enriched, events };
  await saveRun(record);
  await deleteRunMeta(result.runId);
  await deleteRunPid(result.runId);
  await deletePersistedRunEvents(result.runId);
  broadcast("run:result", enriched);
  console.log("[claude:run] run finalized", { runId: result.runId, status: result.status });
  return enriched;
}

function upsertToolEvent(
  state: RunState,
  events: RunEvent[],
  itemId: string,
  kind: RunEventKind,
  label: string,
  detail: string | undefined,
  status: RunEvent["status"],
): void {
  resolveStartingRow(events, state.runId);
  let seq = state.itemSeq.get(itemId);
  if (seq === undefined) {
    seq = state.seq++;
    state.itemSeq.set(itemId, seq);
  }
  const evt: RunEvent = {
    runId: state.runId,
    seq,
    ts: Date.now(),
    kind,
    label,
    detail,
    status,
  };
  const idx = events.findIndex((e) => e.seq === seq);
  if (idx >= 0) events[idx] = evt;
  else events.push(evt);
  broadcast("run:event", evt);
  syncRunTimeline(state.runId, events);
}

function handleClaudeLine(
  parsed: Record<string, unknown>,
  state: RunState,
  events: RunEvent[],
  onStructuredOutput: (value: Record<string, unknown>) => void,
  onTokenUsage: (tu: { inputTokens: number; outputTokens: number }) => void,
  onAgentMessage: (msg: string) => void,
): void {
  const type = parsed["type"] as string | undefined;

  if (type === "result") {
    const structured = parsed["structured_output"] as Record<string, unknown> | undefined;
    if (structured) onStructuredOutput(structured);
    const usage = parsed["usage"] as Record<string, number> | undefined;
    if (usage) {
      onTokenUsage({
        inputTokens: usage["input_tokens"] ?? 0,
        outputTokens: usage["output_tokens"] ?? 0,
      });
    }
    const resultText = parsed["result"] as string | undefined;
    if (resultText?.trim()) onAgentMessage(resultText);
    return;
  }

  if (type === "assistant") {
    const message = parsed["message"] as Record<string, unknown> | undefined;
    const content = message?.["content"] as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(content)) return;

    for (const block of content) {
      const blockType = block["type"] as string | undefined;
      if (blockType === "tool_use") {
        const toolName = (block["name"] as string | undefined) ?? "tool";
        // Only surface Playwright MCP browser actions — hide Write/Bash/StructuredOutput.
        if (!isPlaywrightMcpTool(toolName)) continue;
        const toolId = (block["id"] as string | undefined) ?? toolName;
        const input = (block["input"] as Record<string, unknown> | undefined) ?? {};
        const classified = classifyMcpTool(toolName, input);
        upsertToolEvent(
          state,
          events,
          toolId,
          classified.kind,
          classified.label,
          classified.detail,
          "running",
        );
      } else if (blockType === "text") {
        const text = (block["text"] as string | undefined) ?? "";
        if (text.trim() && !text.trimStart().startsWith("{")) {
          onAgentMessage(text);
        }
      }
    }
    return;
  }

  if (type === "user") {
    const message = parsed["message"] as Record<string, unknown> | undefined;
    const content = message?.["content"] as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(content)) return;
    for (const block of content) {
      if (block["type"] !== "tool_result") continue;
      const toolId = (block["tool_use_id"] as string | undefined) ?? `tool-${state.seq}`;
      const isError = block["is_error"] === true;
      const seq = state.itemSeq.get(toolId);
      if (seq === undefined) continue;
      const idx = events.findIndex((e) => e.seq === seq);
      if (idx < 0) continue;
      events[idx] = { ...events[idx], status: isError ? "failed" : "ok" };
      broadcast("run:event", events[idx]);
      syncRunTimeline(state.runId, events);
    }
  }
}

export async function startClaudeRun(
  runId: string,
  storyName: string,
  storyTitle: string,
  storyFilePath: string,
  claudeBinary: string,
  runHook?: string,
  agentConfig?: AgentRunConfig,
  variableOverrides?: Record<string, string>,
): Promise<RunResult> {
  const startedAt = Date.now();
  const model = agentConfig?.model ?? DEFAULT_CLAUDE_MODEL;
  const state: RunState = {
    runId,
    storyName,
    storyTitle,
    startedAt,
    agentProvider: "claude-code",
    agentModel: model,
    events: [],
    process: null,
    cancelled: false,
    seq: 0,
    itemSeq: new Map<string, number>(),
    queued: true,
    variableOverrides,
  };
  _runs.set(runId, state);
  await writeRunMeta({
    runId,
    storyName,
    storyTitle,
    startedAt,
    agentProvider: "claude-code",
    agentModel: model,
    variableOverrides,
  });

  const runsDir = getRunsDir();
  const runOutputDir = await ensureRunOutputDir(runId);
  const resultPath = path.join(runsDir, `${runId}.result.json`);
  const screenshotPath = getHeroScreenshotPath(runId);
  const stepsPath = getRunStepsPath(runId);
  const screenshotsDir = getRunScreenshotsDir(runId);
  const storyContents = storyFilePath.includes("\n")
    ? storyFilePath
    : await fs.readFile(storyFilePath, "utf-8").catch(() => "");

  const prompt =
    buildRunStoryPlaybook(getSettingsValue().browserMode) +
    buildRunPromptSuffix({
      runOutputDir,
      screenshotsDir,
      stepsPath,
      heroScreenshotPath: screenshotPath,
      storyContents,
      runHook,
    });

  const mcpConfigPath = await writeClaudeMcpConfigFile(
    runOutputDir,
    screenshotsDir,
  );
  const mcpSecretEnv = await playwrightMcpSecretEnv();

  const effort = agentConfig?.effort ?? DEFAULT_CLAUDE_EFFORT;

  const args = [
    "-p",
    prompt,
    "--dangerously-skip-permissions",
    "--strict-mcp-config",
    "--model",
    state.agentModel,
    "--effort",
    effort,
    "--output-format",
    "stream-json",
    "--include-partial-messages",
    "--verbose",
    "--json-schema",
    JSON.stringify(RUN_OUTPUT_SCHEMA),
    "--add-dir",
    runsDir,
    "--add-dir",
    runOutputDir,
    "--mcp-config",
    mcpConfigPath,
  ];

  console.log("[claude:run]", {
    runId,
    storyName,
    claudeBinary,
    args: args.slice(0, 6),
  });

  const events = state.events;

  const pushStatus = (label: string, detail: string): void => {
    const evt: RunEvent = {
      runId,
      seq: state.seq++,
      ts: Date.now(),
      kind: "status",
      label,
      detail,
      status: "running",
    };
    events.push(evt);
    broadcast("run:event", evt);
    syncRunTimeline(runId, events);
  };

  if (isRunSlotBusy()) {
    pushStatus("Queued", "Waiting for another run to finish…");
  }

  await acquireRunSlot();
  state.queued = false;

  if (state.cancelled) {
    _runs.delete(runId);
    releaseRunSlot();
    const cancelledResult: RunResult = {
      runId,
      storyName,
      storyTitle,
      status: "cancelled",
      summary: "",
      assertions: [],
      screenshotPath,
      screenshotUrl: buildScreenshotUrl(runId, screenshotPath),
      startedAt,
      finishedAt: Date.now(),
      error: "Cancelled by user",
      agentProvider: state.agentProvider,
      agentModel: state.agentModel,
    };
    return finalizeRun(cancelledResult, events);
  }

  pushStatus("Starting", `Loading Claude Code for story: ${storyTitle}`);

  const prepEvent = (detail: string): void => {
    const evt: RunEvent = {
      runId,
      seq: state.seq++,
      ts: Date.now(),
      kind: "status",
      label: "Preparing",
      detail,
      status: "running",
    };
    events.push(evt);
    broadcast("run:event", evt);
    syncRunTimeline(runId, events);
  };

  prepEvent("Preparing browser environment…");
  if (getSettingsValue().browserMode === "codex-chrome") {
    releaseRunSlot();
    const msg =
      "Codex Chrome browser mode requires the Codex provider. Switch Agent → Provider to Codex, or choose Private / Playwright.";
    const failEvent: RunEvent = {
      runId,
      seq: state.seq++,
      ts: Date.now(),
      kind: "status",
      label: "Failed",
      detail: msg,
      status: "failed",
    };
    events.push(failEvent);
    broadcast("run:event", failEvent);
    syncRunTimeline(runId, events);
    const failResult: RunResult = {
      runId,
      storyName,
      storyTitle,
      status: "error",
      summary: "",
      assertions: [],
      screenshotPath,
      screenshotUrl: buildScreenshotUrl(runId, screenshotPath),
      startedAt,
      finishedAt: Date.now(),
      error: msg,
      agentProvider: state.agentProvider,
      agentModel: state.agentModel,
    };
    return finalizeRun(failResult, events);
  }
  const prep = await ensurePlaywrightReady({
    onProgress: (p) => prepEvent(p.message),
  });
  if (!prep.ok) {
    releaseRunSlot();
    const msg = prep.error ?? prep.message;
    const failEvent: RunEvent = {
      runId,
      seq: state.seq++,
      ts: Date.now(),
      kind: "error",
      label: "Browser unavailable",
      detail: msg,
      status: "failed",
    };
    events.push(failEvent);
    broadcast("run:event", failEvent);
    syncRunTimeline(runId, events);
    return finalizeRun(
      {
        runId,
        storyName,
        storyTitle,
        status: "error",
        summary: "",
        assertions: [],
        screenshotPath,
        screenshotUrl: buildScreenshotUrl(runId, screenshotPath),
        startedAt,
        finishedAt: Date.now(),
        error: msg,
        agentProvider: state.agentProvider,
        agentModel: state.agentModel,
      },
      events,
    );
  }

  await acquirePlaywrightSlot();

  if (state.cancelled) {
    _runs.delete(runId);
    releaseRunSlot();
    releasePlaywrightSlot();
    const cancelledResult: RunResult = {
      runId,
      storyName,
      storyTitle,
      status: "cancelled",
      summary: "",
      assertions: [],
      screenshotPath,
      screenshotUrl: buildScreenshotUrl(runId, screenshotPath),
      startedAt,
      finishedAt: Date.now(),
      error: "Cancelled by user",
      agentProvider: state.agentProvider,
      agentModel: state.agentModel,
    };
    return finalizeRun(cancelledResult, events);
  }

  const runPromise = new Promise<RunResult>((resolve) => {
    let tokenUsage: { inputTokens: number; outputTokens: number } | undefined;
    let lastAgentMessage = "";
    let structuredOutput: Record<string, unknown> | null = null;
    let buffer = "";
    let stderrBuffer = "";
    let stderrLog = "";

    const child = spawn(claudeBinary, args, {
      cwd: runOutputDir,
      env: { ...buildClaudeSpawnEnv(), ...mcpSecretEnv },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    state.process = child;
    if (child.pid) void writeRunPid(runId, child.pid);

    child.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf-8");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as Record<string, unknown>;
          handleClaudeLine(
            parsed,
            state,
            events,
            (value) => {
              structuredOutput = value;
            },
            (tu) => {
              tokenUsage = tu;
            },
            (msg) => {
              lastAgentMessage = msg;
            },
          );
        } catch {
          // non-JSON stdout line — ignore
        }
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderrBuffer += chunk.toString("utf-8");
      const lines = stderrBuffer.split("\n");
      stderrBuffer = lines.pop() ?? "";
      for (const rawLine of lines) {
        const line = stripAnsi(rawLine).trim();
        if (!line) continue;
        console.error("[claude:run] stderr:", line);
        stderrLog = stderrLog ? `${stderrLog}\n${line}` : line;
      }
    });

    child.on("error", (err) => {
      console.error("[claude:run] spawn error", { runId, err: err.message });
      const errEvent: RunEvent = {
        runId,
        seq: state.seq++,
        ts: Date.now(),
        kind: "error",
        label: "Spawn Error",
        detail: err.message,
        status: "failed",
      };
      events.push(errEvent);
      broadcast("run:event", errEvent);
      syncRunTimeline(runId, events);
      _runs.delete(runId);
      const result = buildErrorResult(
        runId,
        storyName,
        storyTitle,
        startedAt,
        err.message,
        screenshotPath,
        state.agentProvider,
        state.agentModel,
      );
      finalizeRun(result, events).then(resolve);
    });

    child.on("close", async (code, signal) => {
      const cancelled =
        state.cancelled || signal === "SIGTERM" || signal === "SIGKILL";
      _runs.delete(runId);
      console.log("[claude:run] process closed", { runId, code, signal, cancelled });

      if (structuredOutput) {
        await fs.writeFile(resultPath, JSON.stringify(structuredOutput), "utf-8").catch(() => {});
      }

      const structured = structuredOutput ?? (await readResultJson(resultPath));
      const status: RunStatus = cancelled
        ? "cancelled"
        : structured
          ? ((structured["status"] as RunStatus | undefined) ?? (code === 0 ? "passed" : "failed"))
          : code === 0
            ? "passed"
            : "failed";

      const assertions: AssertionResult[] =
        (structured?.["assertions"] as AssertionResult[] | undefined) ?? [];
      const summary: string =
        (structured?.["summary"] as string | undefined) ?? lastAgentMessage ?? "";
      const lastSuccessfulStep: string | undefined = structured?.["lastSuccessfulStep"] as
        | string
        | undefined;
      const finalScreenshotPath: string | undefined =
        (structured?.["screenshotPath"] as string | undefined) ?? screenshotPath;

      const exitError =
        !cancelled && !structured && code != null && code !== 0
          ? stderrLog.trim() || `Claude Code exited with code ${code}`
          : undefined;

      const result: RunResult = {
        runId,
        storyName,
        storyTitle,
        status,
        summary,
        assertions,
        screenshotPath: finalScreenshotPath,
        screenshotUrl: buildScreenshotUrl(runId, finalScreenshotPath),
        lastSuccessfulStep,
        startedAt,
        finishedAt: Date.now(),
        tokenUsage,
        error: cancelled ? "Cancelled by user" : exitError,
        agentProvider: state.agentProvider,
        agentModel: state.agentModel,
      };

      finalizeRun(result, events).then(resolve);
    });
  });

  void runPromise.finally(() => {
    releaseRunSlot();
    releasePlaywrightSlot();
  });
  return runPromise;
}

export function cancelClaudeRun(runId: string): boolean {
  const state = _runs.get(runId);
  if (!state) {
    console.log("[claude:run] cancel ignored — run not active", { runId });
    return false;
  }
  state.cancelled = true;
  if (state.process) {
    state.seq = markRunCancelled(state.events, runId, state.seq);
    syncRunTimeline(runId, state.events);
  }
  if (!state.process) {
    console.log("[claude:run] cancel — run still queued, will finalize cancelled", { runId });
    return true;
  }

  killDetachedAgentProcess(state.process, {
    escalationMs: 3000,
    isStillActive: () => _runs.has(runId),
  });
  console.log("[claude:run] cancel sent", { runId, pid: state.process.pid ?? 0 });
  return true;
}
