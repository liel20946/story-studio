import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { spawn, type ChildProcess } from "child_process";
import { execFile } from "child_process";
import { promisify } from "util";
import { broadcast } from "../broadcast.js";
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
import { writeRunMeta, deleteRunMeta } from "./run-meta.js";
import { getRunsDir } from "./paths.js";
import { RUN_STORY_PLAYBOOK, buildRunPromptSuffix } from "./story-skill.js";
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
  flushPersistRunEvents,
  schedulePersistRunEvents,
  writeRunPid,
} from "./run-events-persist.js";
import {
  acquirePlaywrightSlot,
  releasePlaywrightSlot,
  MAX_CONCURRENT_PLAYWRIGHT,
} from "./playwright-slots.js";
import { buildCodexMcpConfigArgs, ensureCodexProjectConfig } from "./codex-mcp-config.js";
import {
  DEFAULT_CODEX_EFFORT,
  DEFAULT_CODEX_MODEL,
  type AgentRunConfig,
} from "./agent-config.js";
import {
  markRunCancelled,
  settleRunningEvents,
} from "./run-event-settle.js";

const execFileAsync = promisify(execFile);

// How many agent processes may run AT ONCE (single-story + bulk). Playwright
// sessions share the same hard ceiling — see playwright-slots.ts. Bulk runs
// further throttle with maxParallel in bulk-runner.ts.
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
  const existingPath = process.env.PATH ?? "";
  return {
    ...process.env,
    HOME: home,
    PATH: `${extraPath}:${existingPath}`,
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

function toolNameToKind(toolName: string): RunEventKind {
  if (toolName.includes("navigate")) return "navigate";
  if (toolName.includes("click") || toolName.includes("press") || toolName.includes("select")) return "click";
  if (toolName.includes("type") || toolName.includes("fill")) return "type";
  if (toolName.includes("snapshot")) return "snapshot";
  if (toolName.includes("screenshot")) return "screenshot";
  if (toolName.includes("wait")) return "wait";
  if (toolName.includes("evaluate")) return "evaluate";
  return "tool";
}

function toolNameToLabel(toolName: string): string {
  const bare = toolName.replace(/^playwright__browser[-_]?|^browser[-_]?/, "");
  if (bare.includes("screenshot")) return "Screenshot";
  return bare.charAt(0).toUpperCase() + bare.slice(1).replace(/[-_]/g, " ");
}

function extractToolDetail(item: Record<string, unknown>): string | undefined {
  const args = item["arguments"] as Record<string, unknown> | undefined;
  if (!args) return undefined;

  // Prefer a short, human-readable description per tool shape. Never dump raw
  // JSON or evaluate() source — the timeline shows one concise line per action.
  if (typeof args["url"] === "string") return args["url"];
  if (typeof args["element"] === "string") return args["element"];
  if (typeof args["text"] === "string") return args["text"];
  if (typeof args["value"] === "string") return args["value"];
  if (typeof args["selector"] === "string") return args["selector"];
  if (Array.isArray(args["fields"])) {
    const names = (args["fields"] as Array<Record<string, unknown>>)
      .map((f) => (f["name"] ?? f["ref"]) as string | undefined)
      .filter((n): n is string => typeof n === "string");
    return names.length ? names.join(", ") : undefined;
  }
  // browser_evaluate and other code-bearing tools: no detail (script is noise).
  if (typeof args["function"] === "string" || typeof args["expression"] === "string") {
    return undefined;
  }
  const json = JSON.stringify(args);
  return json.length <= 80 ? json : undefined;
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
    RUN_STORY_PLAYBOOK +
    buildRunPromptSuffix({
      runOutputDir,
      screenshotsDir,
      stepsPath,
      heroScreenshotPath: screenshotPath,
      storyContents,
      runHook,
    });

  const effort = agentConfig?.effort ?? DEFAULT_CODEX_EFFORT;

  const args = [
    "exec",
    "--dangerously-bypass-approvals-and-sandbox",
    "--json",
    "--skip-git-repo-check",
    "--ignore-user-config",
    "-C",
    runOutputDir,
    // Pin model + reasoning effort so runs are deterministic regardless of the
    // user's global ~/.codex/config.toml defaults.
    "-c",
    `model="${state.agentModel}"`,
    "-c",
    `model_reasoning_effort="${effort}"`,
    ...buildCodexMcpConfigArgs(),
    "--output-schema",
    schemaPath,
    "-o",
    resultPath,
    prompt,
  ];

  console.log("[codex:run]", { runId, storyName, codexBinary, args: args.slice(0, 8) });

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

  // Wait for a codex exec slot, then a Playwright MCP slot. Singles use both;
  // bulk orchestrators only take a codex slot (subagents acquire Playwright later).
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
    const child = spawn(codexBinary, args, {
      cwd: runOutputDir,
      env: buildEnv(),
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
    const kind = toolNameToKind(fullToolName);
    const label = kind === "evaluate" ? "Thinking" : toolNameToLabel(tool || fullToolName);
    const detail = extractToolDetail(item);
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
  // command_execution and other internal item types (codex reading skills/story
  // files via shell) are intentionally NOT surfaced — the timeline shows browser
  // actions and narration, not codex plumbing.
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
  await flushPersistRunEvents(result.runId, events);
  const enriched = await enrichRunResult(result);
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

  const proc = state.process;
  const pid = proc.pid ?? 0;

  // codex is spawned detached, so it leads its own process group; kill the whole
  // group (`-pid`) to also take down the MCP servers it spawned via npx.
  const killGroup = (sig: NodeJS.Signals) => {
    try {
      if (pid) process.kill(-pid, sig);
      else proc.kill(sig);
    } catch {
      try {
        proc.kill(sig);
      } catch {
        // already gone
      }
    }
  };

  killGroup("SIGTERM");
  // codex can be blocked in a long network MCP call and ignore SIGTERM; force-kill
  // if this run is still in-flight a couple seconds later (the close handler
  // removes it from _runs once the process actually exits).
  setTimeout(() => {
    if (_runs.has(runId)) {
      console.log("[codex:run] SIGTERM ignored — escalating to SIGKILL", runId);
      killGroup("SIGKILL");
    }
  }, 2000);

  console.log("[codex:run] cancelled run", runId);
  return true;
}
