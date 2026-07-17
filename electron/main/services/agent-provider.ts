import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { resolveCodexBinary } from "./codex-runner.js";

const execFileAsync = promisify(execFile);

export type AgentProvider = "codex" | "claude-code";

export const DEFAULT_AGENT_PROVIDER: AgentProvider = "codex";

export function parseAgentProvider(value: unknown): AgentProvider {
  return value === "claude-code" ? "claude-code" : "codex";
}

export async function resolveClaudeBinary(customPath: string | null): Promise<string> {
  if (customPath) {
    try {
      await fs.access(customPath);
      return customPath;
    } catch {
      throw new Error(`claude binary not found at configured path: ${customPath}`);
    }
  }

  const candidates = [
    path.join(os.homedir(), ".local/bin/claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
  ];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // try next
    }
  }

  try {
    const { stdout } = await execFileAsync("/bin/zsh", ["-lc", "command -v claude"], {
      timeout: 10_000,
      maxBuffer: 1024 * 64,
    });
    const resolved = stdout.trim();
    if (resolved) return resolved;
  } catch {
    // fall through
  }

  throw new Error(
    "claude binary not found. Install Claude Code CLI or set a custom path in Settings.\n" +
      "Tried: ~/.local/bin/claude, /opt/homebrew/bin/claude, login shell zsh lookup.",
  );
}

export async function resolveAgentBinary(
  provider: AgentProvider,
  codexBinaryPath: string | null,
  claudeBinaryPath: string | null = null,
): Promise<string> {
  if (provider === "claude-code") {
    return resolveClaudeBinary(claudeBinaryPath);
  }
  return resolveCodexBinary(codexBinaryPath);
}
