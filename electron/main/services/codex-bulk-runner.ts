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
import {
  acquirePlaywrightSlot,
  releasePlaywrightSlot,
  getAvailablePlaywrightSlots,
  MAX_CONCURRENT_PLAYWRIGHT,
} from "./playwright-slots.js";
import { saveRun, buildScreenshotUrl } from "./run-service.js";
import { getRunsDir } from "./paths.js";
import { BULK_RUN_ORCHESTRATOR_PLAYBOOK, RUN_STORY_PLAYBOOK } from "./story-skill.js";
import type { BulkRunOptions } from "./contract-types.js";
import { getHeroScreenshotPath, ensureRunOutputDir } from "./run-artifacts.js";
import { buildCodexMcpConfigArgs, ensureCodexProjectConfig } from "./codex-mcp-config.js";

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
  cancelled: boolean;
  playwrightSlotHeld: boolean;
  playwrightSlotWaiting: boolean;
  sessionPath: string | null;
  sessionOffset: number;
  sessionPoll: ReturnType<typeof setInterval> | null;
}

interface BulkRunState {
  bulkId: string;
  process: ChildProcess | null;
  queued: boolean;
  startedAt: number;
  children: Map<string, ChildRunState>;
  agentToRunId: Map<string, string>;
  pendingSpawnRunIds: string[];
  resultWatcher: fsSync.FSWatcher | null;
  parentSessionPath: string | null;
  parentSessionOffset: number;
  parentSessionPoll: ReturnType<typeof setInterval> | null;
}

const _bulkRuns = new Map<string, BulkRunState>();
// runId -> bulkId for cancel routing
const _runToBulk = new Map<string, string>();

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
  maxParallel: number,
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
    `Playwright MCP limit: run at most ${maxParallel} browser subagent(s) in parallel ` +
    `(global cap is ${MAX_CONCURRENT_PLAYWRIGHT}). Queue the rest — when a subagent finishes ` +
    `(wait_agent + close_agent), spawn the next story.\n\n` +
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
    const matches: string[] = [];
    for await (const entry of glob(`**/rollout-*${agentId}.jsonl`, { cwd: root })) {
      matches.push(entry);
    }
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
      }
      if (!child.playwrightSlotHeld) {
        if (child.playwrightSlotWaiting) return;
        child.playwrightSlotWaiting = true;
        emitChildStatus(
          child,
          "Queued",
          `Waiting for a Playwright slot: ${child.storyTitle}`,
        );
        await acquirePlaywrightSlot();
        child.playwrightSlotHeld = true;
        child.playwrightSlotWaiting = false;
        if (child.finalized || child.cancelled) {
          releasePlaywrightSlot();
          child.playwrightSlotHeld = false;
          return;
        }
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

function childHasAgent(bulk: BulkRunState, runId: string): boolean {
  for (const mapped of bulk.agentToRunId.values()) {
    if (mapped === runId) return true;
  }
  return false;
}

function findAgentIdForRun(bulk: BulkRunState, runId: string): string | null {
  for (const [agentId, mappedRunId] of bulk.agentToRunId) {
    if (mappedRunId === runId) return agentId;
  }
  return null;
}

function activeChildrenRemaining(bulk: BulkRunState): boolean {
  for (const child of bulk.children.values()) {
    if (!child.finalized && !child.cancelled) return true;
  }
  return false;
}

async function writeCancelMarker(
  runsDir: string,
  runId: string,
  agentId?: string,
): Promise<void> {
  const markerPath = path.join(runsDir, `${runId}.cancel`);
  const body = agentId ? JSON.stringify({ agentId }) : "";
  await fs.writeFile(markerPath, body, "utf-8");
}

async function findNewestParentSession(sinceMs: number): Promise<string | null> {
  const root = path.join(os.homedir(), ".codex", "sessions");
  try {
    const matches: string[] = [];
    for await (const rel of glob("**/rollout-*.jsonl", { cwd: root })) {
      matches.push(rel);
    }
    let best: { path: string; mtime: number } | null = null;
    for (const rel of matches) {
      const full = path.join(root, rel);
      const stat = await fs.stat(full);
      if (stat.mtimeMs >= sinceMs - 3000) {
        if (!best || stat.mtimeMs > best.mtime) {
          best = { path: full, mtime: stat.mtimeMs };
        }
      }
    }
    return best?.path ?? null;
  } catch {
    return null;
  }
}

function adaptSessionPayloadToCodexLine(
  payload: Record<string, unknown>,
): Record<string, unknown> | null {
  const ptype = payload["type"] as string | undefined;
  if (ptype === "function_call") {
    return {
      type: "item.completed",
      item: {
        type: "function_call",
        name: payload["name"],
        arguments: payload["arguments"],
        id: payload["id"] ?? payload["call_id"],
      },
    };
  }
  if (ptype === "function_call_output") {
    return {
      type: "item.completed",
      item: {
        type: "function_call_output",
        output: payload["output"],
        id: payload["call_id"],
      },
    };
  }
  return null;
}

function relayOrchestratorStatus(bulk: BulkRunState, detail: string): void {
  const trimmed = detail.trim().slice(0, 200);
  if (!trimmed) return;
  for (const child of bulk.children.values()) {
    if (child.finalized || child.cancelled || childHasAgent(bulk, child.runId)) continue;
    emitChildStatus(child, "Delegating", trimmed);
  }
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
          const child = bulk.children.get(runId);
          if (child?.cancelled) {
            bulk.pendingSpawnRunIds = bulk.pendingSpawnRunIds.filter((id) => id !== runId);
            return;
          }
          bulk.pendingSpawnRunIds.push(runId);
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
          (id) =>
            !childHasAgent(bulk, id) &&
            !bulk.children.get(id)?.finalized &&
            !bulk.children.get(id)?.cancelled,
        );
      if (!runId) return;
      const child = bulk.children.get(runId);
      if (child?.cancelled) {
        void writeCancelMarker(getRunsDir(), runId, out.agent_id);
        return;
      }
      bulk.agentToRunId.set(out.agent_id, runId);
      startSessionPolling(bulk, out.agent_id, runId);
    } catch {
      // ignore
    }
  }
}

function startParentSessionPolling(bulk: BulkRunState): void {
  if (bulk.parentSessionPoll) return;
  bulk.parentSessionPoll = setInterval(() => {
    void (async () => {
      if (!activeChildrenRemaining(bulk)) return;
      if (!bulk.parentSessionPath) {
        bulk.parentSessionPath = await findNewestParentSession(bulk.startedAt);
        if (!bulk.parentSessionPath) return;
        for (const child of bulk.children.values()) {
          if (!child.finalized && !child.cancelled && !childHasAgent(bulk, child.runId)) {
            emitChildStatus(
              child,
              "Starting",
              `Orchestrator running for: ${child.storyTitle}`,
            );
          }
        }
      }
      try {
        const stat = await fs.stat(bulk.parentSessionPath);
        if (stat.size <= bulk.parentSessionOffset) return;
        const handle = await fs.open(bulk.parentSessionPath, "r");
        try {
          const len = stat.size - bulk.parentSessionOffset;
          const buf = Buffer.alloc(len);
          await handle.read(buf, 0, len, bulk.parentSessionOffset);
          bulk.parentSessionOffset = stat.size;
          for (const line of buf.toString("utf-8").split("\n")) {
            if (!line.trim()) continue;
            try {
              const parsed = JSON.parse(line) as Record<string, unknown>;
              if (parsed["type"] === "response_item") {
                const payload = parsed["payload"] as Record<string, unknown> | undefined;
                if (payload) {
                  const adapted = adaptSessionPayloadToCodexLine(payload);
                  if (adapted) handleParentCodexLine(bulk, adapted);
                }
              } else if (parsed["type"] === "event_msg") {
                const payload = parsed["payload"] as Record<string, unknown> | undefined;
                if (payload?.["type"] === "agent_message") {
                  relayOrchestratorStatus(bulk, String(payload["message"] ?? ""));
                }
              }
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
  if (child.playwrightSlotHeld) {
    releasePlaywrightSlot();
    child.playwrightSlotHeld = false;
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
  if (bulk.parentSessionPoll) {
    clearInterval(bulk.parentSessionPoll);
    bulk.parentSessionPoll = null;
  }
  for (const child of bulk.children.values()) {
    if (child.sessionPoll) clearInterval(child.sessionPoll);
  }
}

async function finalizeRemainingChildren(
  bulk: BulkRunState,
  bulkAborted: boolean,
): Promise<void> {
  for (const [runId, child] of bulk.children) {
    if (child.finalized) continue;
    if (!bulkAborted && !child.cancelled) {
      await tryFinalizeFromResultFile(bulk, runId);
    }
    if (!child.finalized) {
      await finalizeChild(
        bulk,
        runId,
        child.cancelled ? "cancelled" : "error",
        "",
        [],
        child.cancelled
          ? "Cancelled by user"
          : "Bulk run ended before this story finished",
      );
    }
  }
}

export async function startBulkRun(
  bulkId: string,
  stories: BulkStoryInput[],
  codexBinary: string,
  runHook?: string,
  options?: BulkRunOptions,
): Promise<void> {
  const runsDir = getRunsDir();
  await writeChildSchemas(stories, runsDir);

  const bulkRoot = path.join(runsDir, `bulk-${bulkId}`);
  await fs.mkdir(bulkRoot, { recursive: true });
  await ensureCodexProjectConfig(runsDir);
  await fs.writeFile(
    path.join(bulkRoot, "run-plan.json"),
    JSON.stringify(
      {
        bulkId,
        startedAt: Date.now(),
        storyCount: stories.length,
        options: options ?? {},
        stories: stories.map((s) => ({ runId: s.runId, storyName: s.storyName, storyTitle: s.storyTitle })),
      },
      null,
      2,
    ),
    "utf-8",
  );

  const children = new Map<string, ChildRunState>();
  const startedAt = Date.now();
  for (const s of stories) {
    await ensureRunOutputDir(s.runId);
    const resultPath = path.join(runsDir, `${s.runId}.result.json`);
    const screenshotPath = getHeroScreenshotPath(s.runId);
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
      cancelled: false,
      playwrightSlotHeld: false,
      playwrightSlotWaiting: false,
      sessionPath: null,
      sessionOffset: 0,
      sessionPoll: null,
    });
    _runToBulk.set(s.runId, bulkId);
    emitChildStatus(
      children.get(s.runId)!,
      "Queued",
      `Waiting for a run slot: ${s.storyTitle}`,
    );
  }

  const bulk: BulkRunState = {
    bulkId,
    process: null,
    queued: true,
    startedAt,
    children,
    agentToRunId: new Map(),
    pendingSpawnRunIds: [],
    resultWatcher: null,
    parentSessionPath: null,
    parentSessionOffset: 0,
    parentSessionPoll: null,
  };
  _bulkRuns.set(bulkId, bulk);

  const maxParallel = Math.max(1, getAvailablePlaywrightSlots());
  const prompt = buildBulkPrompt(stories, runsDir, maxParallel, runHook);
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
    ...buildCodexMcpConfigArgs(),
    prompt,
  ];

  console.log("[codex:bulk]", {
    bulkId,
    storyCount: stories.length,
    maxParallel,
    codexBinary,
  });

  await acquireRunSlot();
  bulk.queued = false;

  if (!activeChildrenRemaining(bulk)) {
    _bulkRuns.delete(bulkId);
    releaseRunSlot();
    return;
  }

  for (const child of bulk.children.values()) {
    if (!child.finalized && !child.cancelled) {
      emitChildStatus(
        child,
        "Starting",
        `Queued in bulk run: ${child.storyTitle}`,
      );
    }
  }

  startResultWatcher(bulk, runsDir);
  startParentSessionPolling(bulk);

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
      const bulkAborted = signal === "SIGTERM" || signal === "SIGKILL";
      console.log("[codex:bulk] process closed", { bulkId, code, signal, bulkAborted });
      stopBulkWatchers(bulk);
      await finalizeRemainingChildren(bulk, bulkAborted);
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

  const child = bulk.children.get(runId);
  if (!child || child.finalized) return false;

  child.cancelled = true;
  bulk.pendingSpawnRunIds = bulk.pendingSpawnRunIds.filter((id) => id !== runId);

  const runsDir = getRunsDir();
  const agentId = findAgentIdForRun(bulk, runId);
  void writeCancelMarker(runsDir, runId, agentId ?? undefined);

  emitChildStatus(child, "Cancelled", "Cancelled by user", "ok");
  void finalizeChild(bulk, runId, "cancelled", "", [], "Cancelled by user");

  console.log("[codex:bulk] cancelled child run", { bulkId, runId, agentId });
  return true;
}

registerBulkCancel(cancelBulkChildRun);
