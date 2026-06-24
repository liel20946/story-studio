import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { spawn, type ChildProcess } from "child_process";
import { broadcast } from "../broadcast.js";
import type {
  RunEvent,
  RunEventKind,
  RunResult,
  RunRecord,
  AssertionResult,
  RunStatus,
} from "./contract-types.js";
import { saveRun, buildScreenshotUrl } from "./run-service.js";
import { getRunsDir } from "./paths.js";
import { RUN_STORY_PLAYBOOK } from "./story-skill.js";
import {
  RUN_OUTPUT_SCHEMA,
  acquireRunSlot,
  releaseRunSlot,
} from "./codex-runner.js";

interface RunState {
  runId: string;
  process: ChildProcess | null;
  cancelled: boolean;
  seq: number;
  itemSeq: Map<string, number>;
  queued: boolean;
}

const _runs = new Map<string, RunState>();

function buildEnv(): NodeJS.ProcessEnv {
  const extraPath = `/opt/homebrew/bin:${path.dirname(process.execPath)}`;
  const existingPath = process.env.PATH ?? "";
  return {
    ...process.env,
    HOME: os.homedir(),
    PATH: `${extraPath}:${existingPath}`,
  };
}

function resolveStartingRow(events: RunEvent[]): void {
  for (const e of events) {
    if (e.kind === "status" && e.status === "running") {
      e.status = "ok";
      broadcast("run:event", { ...e });
    }
  }
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
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
  const bare = toolName.replace(/^mcp__playwright__|^playwright__browser[-_]?|^browser[-_]?/, "");
  return bare.charAt(0).toUpperCase() + bare.slice(1).replace(/[-_]/g, " ");
}

function extractToolInput(input: Record<string, unknown>): string | undefined {
  if (typeof input["url"] === "string") return input["url"];
  if (typeof input["element"] === "string") return input["element"];
  if (typeof input["text"] === "string") return input["text"];
  if (typeof input["value"] === "string") return input["value"];
  if (typeof input["selector"] === "string") return input["selector"];
  const json = JSON.stringify(input);
  return json.length <= 80 ? json : undefined;
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
  };
}

async function finalizeRun(result: RunResult, events: RunEvent[]): Promise<RunResult> {
  const settled: RunEvent["status"] =
    result.status === "failed" || result.status === "error" ? "failed" : "ok";
  for (const e of events) {
    if (e.status === "running") {
      e.status = settled;
      broadcast("run:event", { ...e });
    }
  }
  const record: RunRecord = { ...result, events };
  await saveRun(record);
  broadcast("run:result", result);
  console.log("[claude:run] run finalized", { runId: result.runId, status: result.status });
  return result;
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
  resolveStartingRow(events);
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
        const toolId = (block["id"] as string | undefined) ?? toolName;
        const input = (block["input"] as Record<string, unknown> | undefined) ?? {};
        const kind = toolNameToKind(toolName);
        const label = kind === "evaluate" ? "Thinking" : toolNameToLabel(toolName);
        upsertToolEvent(state, events, toolId, kind, label, extractToolInput(input), "running");
      } else if (blockType === "text") {
        const text = (block["text"] as string | undefined) ?? "";
        if (text.trim() && !text.trimStart().startsWith("{")) {
          onAgentMessage(text);
          resolveStartingRow(events);
          const evt: RunEvent = {
            runId: state.runId,
            seq: state.seq++,
            ts: Date.now(),
            kind: "message",
            label: "Agent",
            detail: text.slice(0, 500),
            status: "ok",
          };
          events.push(evt);
          broadcast("run:event", evt);
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
): Promise<RunResult> {
  const state: RunState = {
    runId,
    process: null,
    cancelled: false,
    seq: 0,
    itemSeq: new Map<string, number>(),
    queued: true,
  };
  _runs.set(runId, state);

  const runsDir = getRunsDir();
  const resultPath = path.join(runsDir, `${runId}.result.json`);
  const screenshotPath = path.join(runsDir, `${runId}.png`);
  const storyContents = await fs.readFile(storyFilePath, "utf-8").catch(() => "");

  const prompt =
    RUN_STORY_PLAYBOOK +
    `\n\n## This run\n` +
    `The full story to run is included below. You already have its complete contents, ` +
    `so do NOT attempt to open or read any local file unless required for the screenshot path.\n\n` +
    "```markdown\n" +
    storyContents +
    "\n```\n\n" +
    `Save the final screenshot to the absolute path ${screenshotPath} (it MUST be inside ${runsDir}). ` +
    `Populate the required output schema with the verdict, per-assertion evidence, the last successful step, and the screenshot path.` +
    (runHook && runHook.trim() ? `\n\n## Additional instructions\n${runHook.trim()}` : "");

  const mcpConfig = JSON.stringify({
    mcpServers: {
      playwright: {
        command: "npx",
        args: ["@playwright/mcp@latest", "--headless", "--isolated"],
      },
    },
  });

  const args = [
    "-p",
    prompt,
    "--dangerously-skip-permissions",
    "--output-format",
    "stream-json",
    "--include-partial-messages",
    "--verbose",
    "--json-schema",
    JSON.stringify(RUN_OUTPUT_SCHEMA),
    "--add-dir",
    runsDir,
    "--mcp-config",
    mcpConfig,
  ];

  console.log("[claude:run]", { runId, storyName, claudeBinary, args: args.slice(0, 6) });

  const startedAt = Date.now();
  const events: RunEvent[] = [];

  const startEvent: RunEvent = {
    runId,
    seq: state.seq++,
    ts: Date.now(),
    kind: "status",
    label: "Starting",
    detail: `Loading Claude Code for story: ${storyTitle}`,
    status: "running",
  };
  events.push(startEvent);
  broadcast("run:event", startEvent);

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
      cwd: runsDir,
      env: buildEnv(),
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    state.process = child;

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
      _runs.delete(runId);
      const result = buildErrorResult(runId, storyName, storyTitle, startedAt, err.message, screenshotPath);
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
      };

      finalizeRun(result, events).then(resolve);
    });
  });

  void runPromise.finally(() => releaseRunSlot());
  return runPromise;
}

export function cancelClaudeRun(runId: string): boolean {
  const state = _runs.get(runId);
  if (!state) {
    console.log("[claude:run] cancel ignored — run not active", { runId });
    return false;
  }
  state.cancelled = true;
  if (!state.process) {
    console.log("[claude:run] cancel — run still queued, will finalize cancelled", { runId });
    return true;
  }

  const proc = state.process;
  const pid = proc.pid ?? 0;
  const killGroup = (sig: NodeJS.Signals) => {
    try {
      process.kill(-pid, sig);
    } catch {
      try {
        proc.kill(sig);
      } catch {
        // already dead
      }
    }
  };
  killGroup("SIGTERM");
  setTimeout(() => killGroup("SIGKILL"), 3000);
  console.log("[claude:run] cancel sent", { runId, pid });
  return true;
}
