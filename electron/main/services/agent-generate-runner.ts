import { spawn, type ChildProcess } from "child_process";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import type { AgentProvider } from "./contract-types.js";
import type { AgentRunConfig } from "./agent-config.js";
import { buildCodexMcpConfigArgs, buildCodexConversionConfigArgs } from "./codex-mcp-config.js";
import {
  extractYamlFromAgentMessage,
  parseAgentMessageFromCodexStdout,
} from "./recording-convert-service.js";
import { progressFromCodexEvent } from "./codex-event-labels.js";

const GENERATE_TIMEOUT_MS = 8 * 60_000;
const REVISION_TIMEOUT_MS = 2 * 60_000;

const _activeChildren = new Map<string, ChildProcess>();
const _cancelledInvocations = new Set<string>();

export class GenerateCancelledError extends Error {
  constructor() {
    super("CANCELLED");
    this.name = "GenerateCancelledError";
  }
}

export function cancelGenerateInvocation(invocationId: string): boolean {
  _cancelledInvocations.add(invocationId);
  const child = _activeChildren.get(invocationId);
  if (!child) return false;
  try {
    child.kill("SIGTERM");
  } catch {
    // ignore
  }
  _activeChildren.delete(invocationId);
  return true;
}

function buildEnv(): NodeJS.ProcessEnv {
  const extraPath = `/opt/homebrew/bin:${path.dirname(process.execPath)}`;
  const existingPath = process.env.PATH ?? "";
  return {
    ...process.env,
    HOME: os.homedir(),
    PATH: `${extraPath}:${existingPath}`,
  };
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
  parseStdout?: (stdout: string, lastMessagePath?: string) => Promise<string>,
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
      try {
        child?.kill("SIGTERM");
      } catch {
        // ignore
      }
      finish(() => reject(new Error("Generation timed out. Try again.")));
    }, timeoutMs);

    child = spawn(command, args, {
      cwd,
      env: buildEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    _activeChildren.set(conversationId, child);

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
  onProgress?: (message: string) => void;
}

export async function invokeGenerateAgent(options: GenerateInvokeOptions): Promise<string> {
  const {
    conversationId,
    invocationId = conversationId,
    prompt,
    outputDir,
    provider,
    agentBinary,
    agentConfig,
    exploring,
    onProgress,
  } = options;

  await fs.mkdir(outputDir, { recursive: true });
  const timeoutMs = exploring ? GENERATE_TIMEOUT_MS : REVISION_TIMEOUT_MS;

  if (provider === "claude-code") {
    return invokeClaude(options, timeoutMs);
  }
  return invokeCodex(options, timeoutMs);
}

async function invokeCodex(
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
    onProgress,
  } = options;
  const lastMessagePath = path.join(outputDir, "agent-last-message.txt");

  const args = [
    "exec",
    "--dangerously-bypass-approvals-and-sandbox",
    "--skip-git-repo-check",
    "--ephemeral",
    "--json",
    "--ignore-user-config",
    "-C",
    outputDir,
    "-c",
    `model="${agentConfig.model}"`,
    ...(exploring ? buildCodexMcpConfigArgs() : buildCodexConversionConfigArgs()),
    "-o",
    lastMessagePath,
    prompt,
  ];

  return spawnTracked(
    invocationId,
    agentBinary,
    args,
    outputDir,
    timeoutMs,
    exploring,
    onProgress,
    async (stdout) => {
      try {
        const fromFile = (await fs.readFile(lastMessagePath, "utf-8")).trim();
        if (fromFile) return fromFile;
      } catch {
        // fall through
      }
      return parseAgentMessageFromCodexStdout(stdout);
    },
  );
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

  if (exploring) {
    const mcpConfig = JSON.stringify({
      mcpServers: {
        playwright: {
          command: "npx",
          args: ["-y", "@playwright/mcp@latest", "--headless", "--isolated"],
        },
      },
    });
    args.push("--mcp-config", mcpConfig);
  }

  onProgress?.(exploring ? "Planning next moves" : "Reviewing your draft");

  const raw = await spawnTracked(
    invocationId,
    agentBinary,
    args,
    outputDir,
    timeoutMs,
    exploring,
    onProgress,
  );
  return raw;
}

export function parseGeneratedYaml(agentMessage: string): string {
  const trimmed = agentMessage.trim();
  if (trimmed.startsWith("ERROR:")) {
    throw new Error(trimmed.replace(/^ERROR:\s*/i, "").trim() || "Generation failed");
  }
  return extractYamlFromAgentMessage(agentMessage);
}
