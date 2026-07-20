import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { spawn, type ChildProcess } from "child_process";
import { execFile } from "child_process";
import { promisify } from "util";
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
  MAX_CONCURRENT_PLAYWRIGHT,
} from "./playwright-slots.js";
import {
  buildCodexPlaywrightMcpConfigArgs,
  ensureCodexProjectConfig,
  playwrightMcpSecretEnv,
} from "./codex-mcp-config.js";
import {
  DEFAULT_CODEX_EFFORT,
  DEFAULT_CODEX_MODEL,
  type AgentRunConfig,
} from "./agent-config.js";
import {
  markRunCancelled,
  settleRunningEvents,
} from "./run-event-settle.js";
import { classifyMcpTool } from "./mcp-tool-event.js";

const execFileAsync = promisify(execFile);

// How many agent processes may run AT ONCE (single-story + bulk). Playwright
// sessions share the same hard ceiling — see playwright-slots.ts. Bulk runs
// fire every story at once and rely on this ceiling to queue the excess.
const MAX_CONCURRENT_RUNS = MAX_CONCURRENT_PLAYWRIGHT;
let _activeRuns = 0;
const _runWaiters: Array<() => void> = [];

// Counting semaphore: every acquire is paired with exactly one release, so the
// active count stays correct even for runs cancelled while still queued.
export function acquireRunSlot(): Promise<void> {
  if (_activeRuns < MAX_CONCURRENT_RUNS) {
    _activeRuns++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => _runWaiters.push(resolve));
}

export function releaseRunSlot(): void {
  const next = _runWaiters.shift();
  if (next) next(); // hand the slot to the next queued run (count unchanged)
  else _activeRuns = Math.max(0, _activeRuns - 1);
}

// Per-run state, keyed by runId, so multiple stories can run CONCURRENTLY (the
// bulk runner fires several at once). Each run owns its own child process,
// cancellation flag, timeline seq counter, and item->seq map. These were
// previously module-level singletons — a second run would reset the first run's
// seq counter (corrupting its timeline) and overwrite its process handle (so
// cancel only hit the last-started run).
interface RunState {
  runId: string;
  storyName: string;
  storyTitle: string;
  startedAt: number;
  agentProvider: "codex";
  agentModel: string;
  events: RunEvent[];
  // Child process — kept for cancellation.
  process: ChildProcess | null;
  // The user asked to cancel. Tracked explicitly so the close handler reports
  // "cancelled" even if codex exits with code 0 (race) or the kill signal is
  // swallowed by an intermediate process — we don't rely on the exit signal.
  cancelled: boolean;
  // Monotonic timeline seq counter for this run's events.
  seq: number;
  // Maps a codex item id -> the timeline seq assigned on item.started, so the
  // matching item.completed updates the SAME row instead of adding a duplicate.
  itemSeq: Map<string, number>;
  // True while the run is waiting in the concurrency queue (no process yet).
  queued: boolean;
}
const _runs = new Map<string, RunState>();

export function listActiveCodexRuns(): ActiveRunSnapshot[] {
  return Array.from(_runs.values()).map((state) => ({
    runId: state.runId,
    storyName: state.storyName,
    storyTitle: state.storyTitle,
    startedAt: state.startedAt,
    agentProvider: state.agentProvider,
    agentModel: state.agentModel,
    events: state.events.filter((e) => !isBenignCodexStderrEvent(e)),
  }));
}

// JSON Schema consumed by `codex exec --output-schema`. Must be written to disk
// before spawn or codex exits with "Failed to read output schema file". Strict-mode
// compatible (all properties required; optionals are nullable).
export const RUN_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: { type: "string", enum: ["passed", "failed"] },
    summary: { type: "string" },
    assertions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          text: { type: "string" },
          passed: { type: "boolean" },
          evidence: { type: ["string", "null"] },
        },
        required: ["text", "passed", "evidence"],
      },
    },
    lastSuccessfulStep: { type: ["string", "null"] },
    screenshotPath: { type: ["string", "null"] },
  },
  required: ["status", "summary", "assertions", "lastSuccessfulStep", "screenshotPath"],
};

// ---------- Binary resolution ----------
export async function resolveCodexBinary(customPath: string | null): Promise<string> {
  if (customPath) {
    try {
      await fs.access(customPath);
      return customPath;
    } catch {
      throw new Error(`codex binary not found at configured path: ${customPath}`);
    }
  }

  const homebrew = "/opt/homebrew/bin/codex";
  try {
    await fs.access(homebrew);
    return homebrew;
  } catch {
    // fall through to login shell lookup
  }
  try {
    const { stdout } = await execFileAsync("/bin/zsh", ["-lc", "command -v codex"], {
      timeout: 10_000,
      maxBuffer: 1024 * 64,
    });
    const resolved = stdout.trim();
    if (resolved) return resolved;
  } catch {
    // fall through
  }

  throw new Error(
    "codex binary not found. Install Codex CLI or set a custom path in Settings.\n" +
      "Tried: /opt/homebrew/bin/codex, login shell zsh lookup.",
  );
}

// ---------- Spawn env ----------
function buildEnv(): NodeJS.ProcessEnv {
  const home = os.homedir();
  const extraPath = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    path.join(home, ".local/bin"),
    path.join(home, ".npm-global/bin"),
    path.dirname(process.execPath),
  ].join(":");
  return {
    ...process.env,
    HOME: home,
    PATH: `${extraPath}:${process.env.PATH ?? ""}`,
  };
}

// ---------- Event helpers ----------
function syncRunTimeline(runId: string, events: RunEvent[]): void {
  schedulePersistRunEvents(runId, events);
}

// Resolve the leading "Starting" status row (and any other lingering status
// spinner) to a settled state once real activity begins, so it doesn't spin
// forever once the run is underway.
function resolveStartingRow(events: RunEvent[], runId: string): void {
  for (const e of events) {
    if (e.kind === "status" && e.status === "running") {
      e.status = "ok";
      broadcast("run:event", { ...e });
    }
  }
  syncRunTimeline(runId, events);
}

// Codex prints some stderr lines during normal startup that are not failures.
// We close stdin (stdio[0] = "ignore") so codex may log "Reading additional
// input from stdin..." — that must not surface as a failed timeline row.
function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

function isBenignCodexStderr(text: string): boolean {
  const trimmed = stripAnsi(text).trim();
  if (!trimmed) return true;
  return /reading additional input from stdin/i.test(trimmed);
}

function isBenignCodexStderrEvent(event: RunEvent): boolean {
  return event.kind === "error" && !!event.detail && isBenignCodexStderr(event.detail);
}

function isToolResultError(item: Record<string, unknown>): boolean {
  // Check item.error first
  if (item["error"]) return true;
  // Check result.content[].text for "### Error" prefix
  const result = item["result"] as Record<string, unknown> | undefined;
  if (result) {
    const content = result["content"] as Array<{ text?: string }> | undefined;
    if (Array.isArray(content)) {
      for (const c of content) {
        if (typeof c.text === "string" && c.text.trimStart().startsWith("### Error")) {
          return true;
        }
      }
    }
  }
  return false;
}

// ---------- Run ----------
export async function startRun(
  runId: string,
  storyName: string,
  storyTitle: string,
  storyFilePath: string,
  codexBinary: string,
  runHook?: string,
  agentConfig?: AgentRunConfig,
  variableOverrides?: Record<string, string>,
): Promise<RunResult> {
  const startedAt = Date.now();
  const model = agentConfig?.model ?? DEFAULT_CODEX_MODEL;
  const state: RunState = {
    runId,
    storyName,
    storyTitle,
    startedAt,
    agentProvider: "codex",
    agentModel: model,
    events: [],
    process: null,
    cancelled: false,
    seq: 0,
    itemSeq: new Map<string, number>(),
    queued: true,
  };
  _runs.set(runId, state);
  await writeRunMeta({
    runId,
    storyName,
    storyTitle,
    startedAt,
    agentProvider: "codex",
    agentModel: model,
    variableOverrides,
  });
  const runsDir = getRunsDir();
  const runOutputDir = await ensureRunOutputDir(runId);
  const schemaPath = path.join(runsDir, `${runId}.schema.json`);
  const resultPath = path.join(runsDir, `${runId}.result.json`);
  const screenshotPath = getHeroScreenshotPath(runId);
  const stepsPath = getRunStepsPath(runId);
  const screenshotsDir = getRunScreenshotsDir(runId);

  // codex --output-schema reads this file; it must exist before spawn.
  await fs.writeFile(schemaPath, JSON.stringify(RUN_OUTPUT_SCHEMA), "utf-8");
  await ensureCodexProjectConfig(runOutputDir);

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

  const effort = agentConfig?.effort ?? DEFAULT_CODEX_EFFORT;
  const mcpConfigArgs = await buildCodexPlaywrightMcpConfigArgs(screenshotsDir);
  const mcpSecretEnv = await playwrightMcpSecretEnv();

  const args = [
    "exec",
    "--dangerously-bypass-approvals-and-sandbox",
    "--json",
    "--skip-git-repo-check",
    // Isolate the run from the user's ~/.codex/config.toml. Without this, codex
    // inherits global settings — notably `[features] multi_agent = true` — and
    // fans a single deterministic story out to PARALLEL sub-agents that each
    // drive the same flow, producing duplicate real-world side effects (e.g.
    // issuing store credit 2–3×), plus loading every global MCP server. The
    // Playwright MCP is registered regardless via the inline `-c mcp_servers.*`
    // injection below (mcpConfigArgs), so runs never depend on the user's
    // global or project Codex config at all.
    "--ignore-user-config",
    "-C",
    runOutputDir,
    "-c",
    `model="${state.agentModel}"`,
    "-c",
    `model_reasoning_effort="${effort}"`,
    ...mcpConfigArgs,
    "--output-schema",
    schemaPath,
    "-o",
    resultPath,
    prompt,
  ];

  console.log("[codex:run] starting", {
    runId,
    storyName,
    codexBinary,
    mcpConfigArgs,
  });

  const events = state.events;

  // Status event — run starting
  const startEvent: RunEvent = {
    runId,
    seq: state.seq++,
    ts: Date.now(),
    kind: "status",
    label: "Starting",
    detail: `Loading codex for story: ${storyTitle}`,
    status: "running",
  };
  events.push(startEvent);
  broadcast("run:event", startEvent);
  syncRunTimeline(runId, events);

  // Wait for a codex exec slot, then (for Playwright mode) a Playwright MCP slot.
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

  // Browser readiness (Playwright CLI + MCP package + Chromium) is warmed once
  // in the background at app launch (prewarmPlaywrightInBackground) — matching
  // shipped v1.5.6, which spawns codex right after acquiring slots. A local
  // change had inserted a blocking ensurePlaywrightReady() preflight here (an
  // extra `npx -y` round-trip plus a "Preparing browser environment…" phase)
  // that delayed the start of every run; that per-run gate is removed.
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
    console.log("[codex:run] spawning codex", { runId, pid: "pending" });
    const child = spawn(codexBinary, args, {
      cwd: runOutputDir,
      env: { ...buildEnv(), ...mcpSecretEnv },
      detached: true, // allows process group kill on cancel
      // stdin must be closed (EOF) or codex hangs on "Reading additional input from stdin..."
      stdio: ["ignore", "pipe", "pipe"],
    });
    state.process = child;
    if (child.pid) void writeRunPid(runId, child.pid);

    let tokenUsage: { inputTokens: number; outputTokens: number } | undefined;
    let lastAgentMessage = "";
    let buffer = "";
    let stderrBuffer = "";
    let stderrLog = "";

    child.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf-8");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as Record<string, unknown>;
          handleCodexLine(parsed, state, events, (tu) => {
            tokenUsage = tu;
          }, (msg) => {
            lastAgentMessage = msg;
          });
        } catch {
          // non-JSON stdout line — ignore
        }
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      // Codex stderr is noisy during normal runs (startup progress, MCP logs).
      // Never mirror it into the live timeline — real failures are surfaced via
      // structured JSON events, result.json, or a non-zero exit code.
      stderrBuffer += chunk.toString("utf-8");
      const lines = stderrBuffer.split("\n");
      stderrBuffer = lines.pop() ?? "";
      for (const rawLine of lines) {
        const line = stripAnsi(rawLine).trim();
        if (!line) continue;
        if (isBenignCodexStderr(line)) {
          console.log("[codex:run] stderr (benign):", line);
          continue;
        }
        console.error("[codex:run] stderr:", line);
        stderrLog = stderrLog ? `${stderrLog}\n${line}` : line;
      }
    });

    child.on("error", (err) => {
      console.error("[codex:run] spawn error", { runId, err: err.message });
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

    child.on("close", (code, signal) => {
      const cancelled =
        state.cancelled || signal === "SIGTERM" || signal === "SIGKILL";
      _runs.delete(runId);
      console.log("[codex:run] process closed", { runId, code, signal, cancelled });

      // Try to read result JSON
      readResultJson(resultPath)
        .then((structured) => {
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
              ? stderrLog.trim() || `Codex exited with code ${code}`
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

          return finalizeRun(result, events).then(resolve);
        })
        .catch((err) => {
          const result = buildErrorResult(
            runId,
            storyName,
            storyTitle,
            startedAt,
            `Failed to read result: ${String(err)}`,
            screenshotPath,
            state.agentProvider,
            state.agentModel,
          );
          return finalizeRun(result, events).then(resolve);
        });
    });
  });

  // Release codex + Playwright slots when the run settles.
  void runPromise.finally(() => {
    releaseRunSlot();
    releasePlaywrightSlot();
  });
  return runPromise;
}

function handleCodexLine(
  parsed: Record<string, unknown>,
  state: RunState,
  events: RunEvent[],
  onTokenUsage: (tu: { inputTokens: number; outputTokens: number }) => void,
  onAgentMessage: (msg: string) => void,
): void {
  const runId = state.runId;
  const type = parsed["type"] as string | undefined;

  if (type === "turn.completed") {
    const usage = parsed["usage"] as Record<string, number> | undefined;
    if (usage) {
      onTokenUsage({
        inputTokens: usage["input_tokens"] ?? 0,
        outputTokens: usage["output_tokens"] ?? 0,
      });
    }
    return;
  }

  if (type !== "item.started" && type !== "item.completed") return;

  const item = parsed["item"] as Record<string, unknown> | undefined;
  if (!item) return;

  const itemType = item["type"] as string | undefined;
  const isStarted = type === "item.started";

  if (itemType === "mcp_tool_call") {
    const server = (item["server"] as string | undefined) ?? "";
    const tool = (item["tool"] as string | undefined) ?? "";
    const fullToolName = `${server}__${tool}`;
    const args = (item["arguments"] as Record<string, unknown> | undefined) ?? {};
    const classified = classifyMcpTool(fullToolName, args);
    const kind = classified.kind;
    const label = classified.label;
    const detail = classified.detail;
    const failed = !isStarted && isToolResultError(item);
    const status: RunEvent["status"] = isStarted ? "running" : failed ? "failed" : "ok";

    // One row per tool call: item.started and item.completed share the codex
    // item id, so they reuse the same seq and the started row is updated in
    // place (running -> ok/failed) instead of producing a duplicate row.
    resolveStartingRow(events, runId);
    const itemId = (item["id"] as string | undefined) ?? `mcp-${state.seq}`;
    let seq = state.itemSeq.get(itemId);
    if (seq === undefined) {
      seq = state.seq++;
      state.itemSeq.set(itemId, seq);
    }

    const evt: RunEvent = {
      runId,
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
    syncRunTimeline(runId, events);
    console.log("[codex:run] tool event", { kind, label, status, tool });
  } else if (itemType === "agent_message") {
    const text = (item["text"] as string | undefined) ?? "";
    // Skip codex's intermediate JSON (structured-output drafts) — the final verdict
    // comes from result.json. Only surface human-readable narration in the timeline.
    if (text && !isStarted && !text.trimStart().startsWith("{")) {
      onAgentMessage(text);
      resolveStartingRow(events, runId);
      const evt: RunEvent = {
        runId,
        seq: state.seq++,
        ts: Date.now(),
        kind: "message",
        label: "Agent",
        detail: text.slice(0, 500),
        status: "ok",
      };
      events.push(evt);
      broadcast("run:event", evt);
      syncRunTimeline(runId, events);
    }
  } else if (itemType === "reasoning") {
    const text = (item["text"] as string | undefined) ?? "";
    if (!isStarted && text.trim()) {
      resolveStartingRow(events, runId);
      const evt: RunEvent = {
        runId,
        seq: state.seq++,
        ts: Date.now(),
        kind: "reasoning",
        label: "Thinking",
        detail: text.slice(0, 200),
        status: "ok",
      };
      events.push(evt);
      broadcast("run:event", evt);
      syncRunTimeline(runId, events);
    }
  }
  // command_execution and other internal item types are intentionally NOT surfaced —
  // the timeline shows Playwright MCP browser actions, not codex plumbing.
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
  agentProvider: "codex" = "codex",
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
  const timelineEvents = events.filter((e) => !isBenignCodexStderrEvent(e));
  events.length = 0;
  events.push(...timelineEvents);

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
  console.log("[codex:run] run finalized", { runId: result.runId, status: result.status });
  return enriched;
}

export function cancelRun(runId: string): boolean {
  const state = _runs.get(runId);
  if (!state) {
    console.log("[codex:run] cancel ignored — run not active", { runId });
    return false;
  }
  // Record intent first so the close handler (or the queued-run path in
  // startRun) finalizes as "cancelled" no matter how the run ends up exiting.
  state.cancelled = true;

  if (state.process) {
    state.seq = markRunCancelled(state.events, runId, state.seq);
    syncRunTimeline(runId, state.events);
  }

  // A queued run has no process yet — marking it cancelled is enough; when its
  // slot opens, startRun finalizes it as cancelled without spawning codex.
  if (!state.process) {
    console.log("[codex:run] cancel — run still queued, will finalize cancelled", { runId });
    return true;
  }

  killDetachedAgentProcess(state.process, {
    isStillActive: () => _runs.has(runId),
    onEscalate: () => {
      console.log("[codex:run] SIGTERM ignored — escalating to SIGKILL", runId);
    },
  });

  console.log("[codex:run] cancelled run", runId);
  return true;
}
