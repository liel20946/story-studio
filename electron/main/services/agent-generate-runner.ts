import { spawn, type ChildProcess } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import type { AgentProvider } from "./contract-types.js";
import type { AgentRunConfig } from "./agent-config.js";
import {
  buildCodexPlaywrightMcpConfigArgs,
  ensureCodexProjectConfig,
  playwrightMcpSecretEnv,
} from "./codex-mcp-config.js";
import { buildCodexChromeConfigArgs } from "./codex-chrome-config.js";
import { getSettingsValue } from "../handlers/settings.js";
import { writeClaudeMcpConfigFile } from "./browser-mcp-config.js";
import {
  extractYamlFromAgentMessage,
  parseAgentMessageFromCodexStdout,
} from "./recording-convert-service.js";
import { progressFromCodexEvent } from "./codex-event-labels.js";
import {
  buildBaseAgentSpawnEnv,
  buildClaudeSpawnEnv,
} from "./agent-spawn-env.js";
import { killDetachedAgentProcess } from "./agent-process-kill.js";

const GENERATE_TIMEOUT_MS = 8 * 60_000;
const REVISION_TIMEOUT_MS = 2 * 60_000;
/** Recording conversion — shorter than open-ended generate. */
export const RECORDING_CONVERT_TIMEOUT_MS = 4 * 60_000;

const _activeChildren = new Map<string, { process: ChildProcess }>();
const _cancelledInvocations = new Set<string>();

export class GenerateCancelledError extends Error {
  constructor() {
    super("CANCELLED");
    this.name = "GenerateCancelledError";
  }
}

export function cancelGenerateInvocation(invocationId: string): boolean {
  _cancelledInvocations.add(invocationId);
  const tracked = _activeChildren.get(invocationId);
  if (!tracked) return false;

  killDetachedAgentProcess(tracked.process, {
    isStillActive: () => _activeChildren.has(invocationId),
    onEscalate: () => {
      console.log("[generate] SIGTERM ignored — escalating to SIGKILL", invocationId);
    },
  });
  return true;
}

function buildCodexModelConfigArgs(agentConfig: AgentRunConfig): string[] {
  return [
    "-c",
    `model="${agentConfig.model}"`,
    "-c",
    `model_reasoning_effort="${agentConfig.effort}"`,
  ];
}

function buildCodexSharedFlags(agentConfig: AgentRunConfig): string[] {
  return [
    "--dangerously-bypass-approvals-and-sandbox",
    "--skip-git-repo-check",
    "--json",
    // Isolate from ~/.codex — browser tools injected via `-c` (Playwright MCP
    // or Chrome node_repl), same as story runs in codex-runner.ts.
    "--ignore-user-config",
    ...buildCodexModelConfigArgs(agentConfig),
  ];
}

export function parseCodexSessionIdFromStdout(stdout: string): string | null {
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const type = parsed["type"] as string | undefined;
      if (type === "session.configured" || type === "session_configured") {
        const id =
          (parsed["session_id"] as string | undefined) ??
          (parsed["sessionId"] as string | undefined);
        if (id?.trim()) return id.trim();
      }
      if (type === "session_meta") {
        const payload = parsed["payload"] as Record<string, unknown> | undefined;
        const id = payload?.["id"] as string | undefined;
        if (id?.trim()) return id.trim();
      }
    } catch {
      // ignore non-JSON lines
    }
  }
  return null;
}

function progressFromCodexLine(line: string, exploring: boolean): string | null {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    return progressFromCodexEvent(parsed, exploring);
  } catch {
    return null;
  }
}

function spawnTracked(
  conversationId: string,
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  exploring: boolean,
  onProgress?: (message: string) => void,
  parseStdout?: (stdout: string) => Promise<string>,
  env: NodeJS.ProcessEnv = buildBaseAgentSpawnEnv(),
): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let stdoutBuffer = "";
    let settled = false;
    let child: ChildProcess | null = null;
    let lastProgress: string | null = null;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      _activeChildren.delete(conversationId);
      fn();
    };

    const timer = setTimeout(() => {
      const tracked = _activeChildren.get(conversationId);
      if (tracked) {
        killDetachedAgentProcess(tracked.process);
      }
      finish(() => reject(new Error("Generation timed out. Try again.")));
    }, timeoutMs);

    child = spawn(command, args, {
      cwd,
      env,
      detached: true, // allows process group kill on cancel
      stdio: ["ignore", "pipe", "pipe"],
    });
    _activeChildren.set(conversationId, { process: child });

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      stdout += text;
      stdoutBuffer += text;
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) {
        const progress = progressFromCodexLine(line, exploring);
        if (progress && progress !== lastProgress) {
          lastProgress = progress;
          onProgress?.(progress);
        }
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      stderr += text;
      const trimmed = text.trim();
      if (trimmed) console.error("[generate] stderr:", trimmed);
    });

    child.on("error", (err) => {
      finish(() => reject(new Error(`Generation failed: ${err.message}`)));
    });

    child.on("close", async (code) => {
      try {
        if (_cancelledInvocations.delete(conversationId)) {
          finish(() => reject(new GenerateCancelledError()));
          return;
        }
        if (parseStdout) {
          const message = await parseStdout(stdout);
          if (!message.trim()) {
            const detail = stderr.trim() || `exit code ${code ?? "?"}`;
            finish(() => reject(new Error(`Agent did not produce story content. ${detail}`)));
            return;
          }
          finish(() => resolve(message));
          return;
        }
        const trimmed = stdout.trim();
        if (!trimmed) {
          const detail = stderr.trim() || `exit code ${code ?? "?"}`;
          finish(() => reject(new Error(`Agent did not produce story content. ${detail}`)));
          return;
        }
        finish(() => resolve(trimmed));
      } catch (err) {
        finish(() => reject(err));
      }
    });
  });
}

export interface GenerateInvokeOptions {
  conversationId: string;
  /** Child-process map key; defaults to conversationId. Use a suffix for parallel lightweight calls. */
  invocationId?: string;
  prompt: string;
  outputDir: string;
  provider: AgentProvider;
  agentBinary: string;
  agentConfig: AgentRunConfig;
  exploring: boolean;
  /** Claude: stable session id (conversation uuid). Codex: rollout session id when resuming. */
  sessionId?: string;
  /** Continue an existing provider session instead of starting fresh. */
  resumeSession?: boolean;
  /** Claude first turn: playbook / system instructions. */
  systemPrompt?: string;
  /** One-off runs (e.g. title suggestion) that must not join the conversation session. */
  ephemeral?: boolean;
  /** Override default exploring / revision timeouts (e.g. recording conversion). */
  timeoutMs?: number;
  onProgress?: (message: string) => void;
}

export interface GenerateInvokeResult {
  message: string;
  codexSessionId?: string;
}

export async function invokeGenerateAgent(
  options: GenerateInvokeOptions,
): Promise<GenerateInvokeResult> {
  const {
    conversationId,
    invocationId = conversationId,
    outputDir,
    provider,
    exploring,
  } = options;

  await fs.mkdir(outputDir, { recursive: true });
  const timeoutMs =
    options.timeoutMs ?? (exploring ? GENERATE_TIMEOUT_MS : REVISION_TIMEOUT_MS);

  if (provider === "claude-code") {
    const message = await invokeClaude(options, timeoutMs);
    return { message };
  }
  return invokeCodex(options, timeoutMs, invocationId);
}

async function invokeCodex(
  options: GenerateInvokeOptions,
  timeoutMs: number,
  invocationId: string,
): Promise<GenerateInvokeResult> {
  const {
    prompt,
    outputDir,
    agentBinary,
    agentConfig,
    exploring,
    sessionId,
    resumeSession,
    ephemeral,
    onProgress,
  } = options;
  const lastMessagePath = path.join(outputDir, "agent-last-message.txt");

  const parseStdout = async (stdout: string) => {
    try {
      const fromFile = (await fs.readFile(lastMessagePath, "utf-8")).trim();
      if (fromFile) return fromFile;
    } catch {
      // fall through
    }
    return parseAgentMessageFromCodexStdout(stdout);
  };

  // Always isolate from ~/.codex. Playwright MCP or Chrome node_repl is
  // injected via `-c` below — never load the user's full MCP set.
  const sharedFlags = buildCodexSharedFlags(agentConfig);
  const browserMode = getSettingsValue().browserMode;
  const useCodexChrome = browserMode === "codex-chrome";
  const mcpArgs = exploring
    ? useCodexChrome
      ? await buildCodexChromeConfigArgs()
      : await buildCodexPlaywrightMcpConfigArgs()
    : [];

  const spawnEnv = {
    ...buildBaseAgentSpawnEnv(),
    ...(exploring && !useCodexChrome ? await playwrightMcpSecretEnv() : {}),
  };

  if (resumeSession && sessionId) {
    const args = [
      "exec",
      "resume",
      ...sharedFlags,
      ...mcpArgs,
      "-o",
      lastMessagePath,
      sessionId,
      prompt,
    ];

    const message = await spawnTracked(
      invocationId,
      agentBinary,
      args,
      outputDir,
      timeoutMs,
      exploring,
      onProgress,
      parseStdout,
      spawnEnv,
    );
    return { message };
  }

  if (exploring && !useCodexChrome) {
    await ensureCodexProjectConfig(outputDir);
  }

  const args = [
    "exec",
    ...sharedFlags,
    "-C",
    outputDir,
    ...mcpArgs,
    ...(ephemeral ? ["--ephemeral"] : []),
    "-o",
    lastMessagePath,
    prompt,
  ];

  let capturedStdout = "";
  const message = await spawnTracked(
    invocationId,
    agentBinary,
    args,
    outputDir,
    timeoutMs,
    exploring,
    onProgress,
    async (stdout) => {
      capturedStdout = stdout;
      return parseStdout(stdout);
    },
    spawnEnv,
  );

  const parsedSessionId = parseCodexSessionIdFromStdout(capturedStdout);
  const codexSessionId = ephemeral ? undefined : (parsedSessionId ?? undefined);
  return { message, codexSessionId };
}

async function invokeClaude(
  options: GenerateInvokeOptions,
  timeoutMs: number,
): Promise<string> {
  const {
    conversationId,
    invocationId = conversationId,
    prompt,
    outputDir,
    agentBinary,
    agentConfig,
    exploring,
    sessionId,
    resumeSession,
    systemPrompt,
    onProgress,
  } = options;

  const args = [
    "-p",
    prompt,
    "--dangerously-skip-permissions",
    "--model",
    agentConfig.model,
    "--effort",
    agentConfig.effort,
    "--output-format",
    "text",
  ];

  if (resumeSession && sessionId) {
    args.push("--resume", sessionId);
  } else if (sessionId) {
    args.push("--session-id", sessionId);
    if (systemPrompt?.trim()) {
      args.push("--system-prompt", systemPrompt);
    }
  }

  if (exploring && !resumeSession) {
    const mcpConfigPath = await writeClaudeMcpConfigFile(outputDir);
    args.push("--strict-mcp-config", "--mcp-config", mcpConfigPath);
  }

  const spawnEnv = {
    ...buildClaudeSpawnEnv(),
    ...(exploring ? await playwrightMcpSecretEnv() : {}),
  };

  onProgress?.(exploring ? "Planning next moves" : "Reviewing your draft");

  return spawnTracked(
    invocationId,
    agentBinary,
    args,
    outputDir,
    timeoutMs,
    exploring,
    onProgress,
    undefined,
    spawnEnv,
  );
}

export function parseGeneratedYaml(agentMessage: string): string {
  const trimmed = agentMessage.trim();
  if (trimmed.startsWith("ERROR:")) {
    throw new Error(trimmed.replace(/^ERROR:\s*/i, "").trim() || "Generation failed");
  }
  return extractYamlFromAgentMessage(agentMessage);
}
