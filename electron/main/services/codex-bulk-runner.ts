import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import * as os from "os";
import { spawn, type ChildProcess } from "child_process";
import { glob } from "fs/promises";
import { broadcast } from "../broadcast.js";
import type {
  RunEvent,
  RunEventKind,
  RunResult,
  RunRecord,
  AssertionResult,
  RunStatus,
} from "./contract-types.js";
import {
  acquireRunSlot,
  releaseRunSlot,
  registerBulkCancel,
  RUN_OUTPUT_SCHEMA,
} from "./codex-runner.js";
import { saveRun, buildScreenshotUrl } from "./run-service.js";
import { getRunsDir } from "./paths.js";
import { BULK_RUN_ORCHESTRATOR_PLAYBOOK, RUN_STORY_PLAYBOOK } from "./story-skill.js";

const RUN_MODEL = "gpt-5.5";
const RUN_REASONING_EFFORT = "medium";

export interface BulkStoryInput {
  runId: string;
  storyName: string;
  storyTitle: string;
  storyContents: string;
}

interface ChildRunState {
  runId: string;
  storyName: string;
  storyTitle: string;
  startedAt: number;
  seq: number;
  itemSeq: Map<string, number>;
  events: RunEvent[];
  resultPath: string;
  screenshotPath: string;
  finalized: boolean;
  sessionPath: string | null;
  sessionOffset: number;
  sessionPoll: ReturnType<typeof setInterval> | null;
}

interface BulkRunState {
  bulkId: string;
  process: ChildProcess | null;
  cancelled: boolean;
  queued: boolean;
  children: Map<string, ChildRunState>;
  agentToRunId: Map<string, string>;
  pendingSpawnRunIds: string[];
  resultWatcher: fsSync.FSWatcher | null;
}

const _bulkRuns = new Map<string, BulkRunState>();
// runId -> bulkId for cancel routing
const _runToBulk = new Map<string, string>();

function buildEnv(): NodeJS.ProcessEnv {
  const extraPath = `/opt/homebrew/bin:${path.dirname(process.execPath)}`;
  const existingPath = process.env.PATH ?? "";
  return {
    ...process.env,
    HOME: os.homedir(),
    PATH: `${extraPath}:${existingPath}`,
  };
}

function toolNameToKind(toolName: string): RunEventKind {
  if (toolName.includes("navigate")) return "navigate";
  if (toolName.includes("click") || toolName.includes("press") || toolName.includes("select"))
    return "click";
  if (toolName.includes("type") || toolName.includes("fill")) return "type";
  if (toolName.includes("snapshot")) return "snapshot";
  if (toolName.includes("screenshot")) return "screenshot";
  if (toolName.includes("wait")) return "wait";
  if (toolName.includes("evaluate")) return "evaluate";
  return "tool";
}

function toolNameToLabel(toolName: string): string {
  const bare = toolName.replace(/^playwright__browser[-_]?|^browser[-_]?/, "");
  return bare.charAt(0).toUpperCase() + bare.slice(1).replace(/[-_]/g, " ");
}

function extractInvocationDetail(invocation: Record<string, unknown>): string | undefined {
  const args = invocation["arguments"] as Record<string, unknown> | undefined;
  if (!args) return undefined;
  if (typeof args["url"] === "string") return args["url"];
  if (typeof args["element"] === "string") return args["element"];
  if (typeof args["text"] === "string") return args["text"];
  if (typeof args["value"] === "string") return args["value"];
  if (typeof args["selector"] === "string") return args["selector"];
  return undefined;
}

function pushChildEvent(child: ChildRunState, evt: RunEvent): void {
  const idx = child.events.findIndex((e) => e.seq === evt.seq);
  if (idx >= 0) child.events[idx] = evt;
  else child.events.push(evt);
  broadcast("run:event", evt);
}

function emitChildStatus(
  child: ChildRunState,
  label: string,
  detail: string,
  status: RunEvent["status"] = "running",
): void {
  const evt: RunEvent = {
    runId: child.runId,
    seq: child.seq++,
    ts: Date.now(),
    kind: "status",
    label,
    detail,
    status,
  };
  pushChildEvent(child, evt);
}

function emitChildToolEvent(
  child: ChildRunState,
  itemId: string,
  tool: string,
  detail: string | undefined,
  status: RunEvent["status"],
): void {
  const kind = toolNameToKind(tool);
  const label = kind === "evaluate" ? "Thinking" : toolNameToLabel(tool);
  let seq = child.itemSeq.get(itemId);
  if (seq === undefined) {
    seq = child.seq++;
    child.itemSeq.set(itemId, seq);
  }
  pushChildEvent(child, {
    runId: child.runId,
    seq,
    ts: Date.now(),
    kind,
    label,
    detail,
    status,
  });
}

function buildSubagentMessage(
  entry: BulkStoryInput,
  runsDir: string,
  runHook?: string,
): string {
  const resultPath = path.join(runsDir, `${entry.runId}.result.json`);
  const screenshotPath = path.join(runsDir, `${entry.runId}.png`);
  const schemaPath = path.join(runsDir, `${entry.runId}.schema.json`);
  return (
    RUN_STORY_PLAYBOOK +
    `\n\n## This subagent run\n` +
    `Run this story as a subagent. runId: ${entry.runId}\n` +
    `Story title: ${entry.storyTitle}\n` +
    `Screenshot path (MUST save final screenshot here): ${screenshotPath}\n` +
    `Result JSON path (MUST write structured output here): ${resultPath}\n` +
    `Output schema file: ${schemaPath}\n\n` +
    `The story markdown is below. Do NOT read any other local file.\n\n` +
    "```markdown\n" +
    entry.storyContents +
    "\n```\n\n" +
    `After running, write JSON matching the schema at ${schemaPath} to ${resultPath}. ` +
    `Include status (passed/failed), summary, assertions, lastSuccessfulStep, and screenshotPath.` +
    (runHook && runHook.trim() ? `\n\n## Additional instructions\n${runHook.trim()}` : "")
  );
}

function buildBulkPrompt(
  stories: BulkStoryInput[],
  runsDir: string,
  runHook?: string,
): string {
  const assignments = stories
    .map((s, i) => {
      const resultPath = path.join(runsDir, `${s.runId}.result.json`);
      const screenshotPath = path.join(runsDir, `${s.runId}.png`);
      const schemaPath = path.join(runsDir, `${s.runId}.schema.json`);
      return (
        `### Story ${i + 1}: ${s.storyTitle}\n` +
        `- runId: ${s.runId}\n` +
        `- screenshot: ${screenshotPath}\n` +
        `- result JSON: ${resultPath}\n` +
        `- schema: ${schemaPath}\n` +
        `- spawn message body:\n` +
        buildSubagentMessage(s, runsDir, runHook)
      );
    })
    .join("\n\n");

  return (
    BULK_RUN_ORCHESTRATOR_PLAYBOOK +
    `\n\n## Bulk run assignments (${stories.length} stories)\n` +
    `Spawn one subagent per story below using spawn_agent. ` +
    `Launch them all in parallel, wait for each to finish, then close_agent each one.\n\n` +
    assignments
  );
}

async function writeChildSchemas(stories: BulkStoryInput[], runsDir: string): Promise<void> {
  const schemaJson = JSON.stringify(RUN_OUTPUT_SCHEMA);
  await Promise.all(
    stories.map((s) =>
      fs.writeFile(path.join(runsDir, `${s.runId}.schema.json`), schemaJson, "utf-8"),
    ),
  );
}

async function findSubagentSession(agentId: string): Promise<string | null> {
  const root = path.join(os.homedir(), ".codex", "sessions");
  try {
    const matches = await glob(`**/rollout-*${agentId}.jsonl`, { cwd: root });
    if (matches.length === 0) return null;
    return path.join(root, matches[matches.length - 1]!);
  } catch {
    return null;
  }
}

function startSessionPolling(bulk: BulkRunState, agentId: string, runId: string): void {
  const child = bulk.children.get(runId);
  if (!child || child.sessionPoll) return;

  child.sessionPoll = setInterval(() => {
    void (async () => {
      if (child.finalized) return;
      if (!child.sessionPath) {
        child.sessionPath = await findSubagentSession(agentId);
        if (!child.sessionPath) return;
        emitChildStatus(child, "Running", `Subagent started for: ${child.storyTitle}`, "running");
      }
      try {
        const stat = await fs.stat(child.sessionPath);
        if (stat.size <= child.sessionOffset) return;
        const handle = await fs.open(child.sessionPath, "r");
        try {
          const len = stat.size - child.sessionOffset;
          const buf = Buffer.alloc(len);
          await handle.read(buf, 0, len, child.sessionOffset);
          child.sessionOffset = stat.size;
          for (const line of buf.toString("utf-8").split("\n")) {
            if (!line.trim()) continue;
            try {
              handleSubagentSessionLine(JSON.parse(line) as Record<string, unknown>, child);
            } catch {
              // ignore non-JSON lines
            }
          }
        } finally {
          await handle.close();
        }
      } catch {
        // session file may rotate or disappear briefly
      }
    })();
  }, 500);
}

function handleSubagentSessionLine(parsed: Record<string, unknown>, child: ChildRunState): void {
  if (parsed["type"] !== "event_msg") return;
  const payload = parsed["payload"] as Record<string, unknown> | undefined;
  if (!payload) return;

  const msgType = payload["type"] as string | undefined;
  if (msgType === "mcp_tool_call_start") {
    const invocation = payload["invocation"] as Record<string, unknown> | undefined;
    const tool = (invocation?.["tool"] as string | undefined) ?? "tool";
    const callId = (payload["call_id"] as string | undefined) ?? `tool-${child.seq}`;
    emitChildToolEvent(child, callId, tool, extractInvocationDetail(invocation ?? {}), "running");
    return;
  }
  if (msgType === "mcp_tool_call_end") {
    const invocation = payload["invocation"] as Record<string, unknown> | undefined;
    const tool = (invocation?.["tool"] as string | undefined) ?? "tool";
    const callId = (payload["call_id"] as string | undefined) ?? `tool-${child.seq}`;
    const result = payload["result"] as Record<string, unknown> | undefined;
    const failed = !!result && "Err" in result;
    emitChildToolEvent(
      child,
      callId,
      tool,
      extractInvocationDetail(invocation ?? {}),
      failed ? "failed" : "ok",
    );
  }
}

function mapSpawnToChild(bulk: BulkRunState, spawnArgs: string): string | null {
  try {
    const parsed = JSON.parse(spawnArgs) as { message?: string };
    const message = parsed.message ?? "";
    const match = /runId:\s*([0-9a-f-]{36})/i.exec(message);
    if (match?.[1] && bulk.children.has(match[1])) return match[1];
  } catch {
    // fall through
  }
  return null;
}

function handleParentCodexLine(bulk: BulkRunState, parsed: Record<string, unknown>): void {
  const type = parsed["type"] as string | undefined;
  if (type !== "item.started" && type !== "item.completed") return;

  const item = parsed["item"] as Record<string, unknown> | undefined;
  if (!item) return;
  const itemType = item["type"] as string | undefined;
  const isCompleted = type === "item.completed";

  if (itemType === "function_call" && isCompleted) {
    const name = item["name"] as string | undefined;
    if (name === "spawn_agent") {
      const args = item["arguments"] as string | undefined;
      if (args) {
        const runId = mapSpawnToChild(bulk, args);
        if (runId) {
          bulk.pendingSpawnRunIds.push(runId);
          const child = bulk.children.get(runId);
          if (child) {
            emitChildStatus(child, "Delegating", `Spawning subagent for: ${child.storyTitle}`);
          }
        }
      }
    }
    return;
  }

  if (itemType === "function_call_output" && isCompleted) {
    const output = item["output"] as string | undefined;
    if (!output) return;
    try {
      const out = JSON.parse(output) as { agent_id?: string };
      if (!out.agent_id) return;
      const runId =
        bulk.pendingSpawnRunIds.shift() ??
        [...bulk.children.keys()].find(
          (id) => !childHasAgent(bulk, id) && !bulk.children.get(id)?.finalized,
        );
      if (!runId) return;
      bulk.agentToRunId.set(out.agent_id, runId);
      startSessionPolling(bulk, out.agent_id, runId);
    } catch {
      // ignore
    }
  }
}

function childHasAgent(bulk: BulkRunState, runId: string): boolean {
  for (const mapped of bulk.agentToRunId.values()) {
    if (mapped === runId) return true;
  }
  return false;
}

async function finalizeChild(
  bulk: BulkRunState,
  runId: string,
  status: RunStatus,
  summary: string,
  assertions: AssertionResult[],
  error?: string,
  lastSuccessfulStep?: string,
): Promise<void> {
  const child = bulk.children.get(runId);
  if (!child || child.finalized) return;
  child.finalized = true;
  if (child.sessionPoll) {
    clearInterval(child.sessionPoll);
    child.sessionPoll = null;
  }

  for (const e of child.events) {
    if (e.status === "running") {
      e.status = status === "failed" || status === "error" ? "failed" : "ok";
      broadcast("run:event", { ...e });
    }
  }

  const result: RunResult = {
    runId,
    storyName: child.storyName,
    storyTitle: child.storyTitle,
    status,
    summary,
    assertions,
    screenshotPath: child.screenshotPath,
    screenshotUrl: buildScreenshotUrl(runId, child.screenshotPath),
    lastSuccessfulStep,
    startedAt: child.startedAt,
    finishedAt: Date.now(),
    error,
  };
  const record: RunRecord = { ...result, events: child.events };
  await saveRun(record);
  broadcast("run:result", result);
  _runToBulk.delete(runId);
}

async function tryFinalizeFromResultFile(bulk: BulkRunState, runId: string): Promise<void> {
  const child = bulk.children.get(runId);
  if (!child || child.finalized) return;
  try {
    const data = await fs.readFile(child.resultPath, "utf-8");
    const structured = JSON.parse(data) as Record<string, unknown>;
    const status = (structured["status"] as RunStatus | undefined) ?? "passed";
    const assertions = (structured["assertions"] as AssertionResult[] | undefined) ?? [];
    const summary = (structured["summary"] as string | undefined) ?? "";
    const lastSuccessfulStep = structured["lastSuccessfulStep"] as string | undefined;
    await finalizeChild(bulk, runId, status, summary, assertions, undefined, lastSuccessfulStep);
  } catch {
    // not ready yet
  }
}

function startResultWatcher(bulk: BulkRunState, runsDir: string): void {
  bulk.resultWatcher = fsSync.watch(runsDir, (_event, filename) => {
    if (!filename || !filename.endsWith(".result.json")) return;
    const runId = filename.replace(/\.result\.json$/, "");
    if (bulk.children.has(runId)) {
      void tryFinalizeFromResultFile(bulk, runId);
    }
  });
}

function stopBulkWatchers(bulk: BulkRunState): void {
  bulk.resultWatcher?.close();
  bulk.resultWatcher = null;
  for (const child of bulk.children.values()) {
    if (child.sessionPoll) clearInterval(child.sessionPoll);
  }
}

async function finalizeRemainingChildren(
  bulk: BulkRunState,
  cancelled: boolean,
): Promise<void> {
  for (const [runId, child] of bulk.children) {
    if (child.finalized) continue;
    if (!cancelled) {
      await tryFinalizeFromResultFile(bulk, runId);
    }
    if (!child.finalized) {
      await finalizeChild(
        bulk,
        runId,
        cancelled ? "cancelled" : "error",
        "",
        [],
        cancelled ? "Cancelled by user" : "Bulk run ended before this story finished",
      );
    }
  }
}

export async function startBulkRun(
  bulkId: string,
  stories: BulkStoryInput[],
  codexBinary: string,
  runHook?: string,
): Promise<void> {
  const runsDir = getRunsDir();
  await writeChildSchemas(stories, runsDir);

  const children = new Map<string, ChildRunState>();
  const startedAt = Date.now();
  for (const s of stories) {
    const resultPath = path.join(runsDir, `${s.runId}.result.json`);
    const screenshotPath = path.join(runsDir, `${s.runId}.png`);
    children.set(s.runId, {
      runId: s.runId,
      storyName: s.storyName,
      storyTitle: s.storyTitle,
      startedAt,
      seq: 0,
      itemSeq: new Map(),
      events: [],
      resultPath,
      screenshotPath,
      finalized: false,
      sessionPath: null,
      sessionOffset: 0,
      sessionPoll: null,
    });
    _runToBulk.set(s.runId, bulkId);
    emitChildStatus(
      children.get(s.runId)!,
      "Starting",
      `Queued in bulk run: ${s.storyTitle}`,
    );
  }

  const bulk: BulkRunState = {
    bulkId,
    process: null,
    cancelled: false,
    queued: true,
    children,
    agentToRunId: new Map(),
    pendingSpawnRunIds: [],
    resultWatcher: null,
  };
  _bulkRuns.set(bulkId, bulk);

  const prompt = buildBulkPrompt(stories, runsDir, runHook);
  const args = [
    "exec",
    "--dangerously-bypass-approvals-and-sandbox",
    "--json",
    "--skip-git-repo-check",
    "-C",
    runsDir,
    "-c",
    `model="${RUN_MODEL}"`,
    "-c",
    `model_reasoning_effort="${RUN_REASONING_EFFORT}"`,
    "-c",
    "features.multi_agent=true",
    "-c",
    "mcp_servers.node_repl.enabled=false",
    "-c",
    'mcp_servers.playwright.args=["@playwright/mcp@latest","--headless","--isolated"]',
    prompt,
  ];

  console.log("[codex:bulk]", { bulkId, storyCount: stories.length, codexBinary });

  await acquireRunSlot();
  bulk.queued = false;

  if (bulk.cancelled) {
    _bulkRuns.delete(bulkId);
    releaseRunSlot();
    await finalizeRemainingChildren(bulk, true);
    return;
  }

  startResultWatcher(bulk, runsDir);

  const runPromise = new Promise<void>((resolve) => {
    const child = spawn(codexBinary, args, {
      cwd: runsDir,
      env: buildEnv(),
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    bulk.process = child;

    let buffer = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf-8");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          handleParentCodexLine(bulk, JSON.parse(line) as Record<string, unknown>);
        } catch {
          // ignore
        }
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      console.error("[codex:bulk] stderr:", chunk.toString("utf-8").trim());
    });

    child.on("error", async (err) => {
      console.error("[codex:bulk] spawn error", { bulkId, err: err.message });
      stopBulkWatchers(bulk);
      await finalizeRemainingChildren(bulk, false);
      _bulkRuns.delete(bulkId);
      resolve();
    });

    child.on("close", async (code, signal) => {
      const cancelled =
        bulk.cancelled || signal === "SIGTERM" || signal === "SIGKILL";
      console.log("[codex:bulk] process closed", { bulkId, code, signal, cancelled });
      stopBulkWatchers(bulk);
      await finalizeRemainingChildren(bulk, cancelled);
      _bulkRuns.delete(bulkId);
      resolve();
    });
  });

  void runPromise.finally(() => releaseRunSlot());
}

export function cancelBulkChildRun(runId: string): boolean {
  const bulkId = _runToBulk.get(runId);
  if (!bulkId) return false;
  const bulk = _bulkRuns.get(bulkId);
  if (!bulk) return false;

  bulk.cancelled = true;
  const proc = bulk.process;
  const pid = proc?.pid ?? 0;
  const killGroup = (sig: NodeJS.Signals) => {
    try {
      if (pid) process.kill(-pid, sig);
      else proc?.kill(sig);
    } catch {
      try {
        proc?.kill(sig);
      } catch {
        // already gone
      }
    }
  };

  if (proc) {
    killGroup("SIGTERM");
    setTimeout(() => {
      if (_bulkRuns.has(bulkId)) killGroup("SIGKILL");
    }, 2000);
  }

  console.log("[codex:bulk] cancelled bulk run", { bulkId, runId });
  return true;
}

registerBulkCancel(cancelBulkChildRun);
