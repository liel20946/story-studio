import { existsSync } from "fs";
import * as fs from "fs/promises";
import * as path from "path";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { shell } from "../electron-api.js";
import { broadcast } from "../broadcast.js";
import { patchRunMetaProviderSession } from "./run-meta.js";
import { getCodexHome } from "./codex-chrome-config.js";
import type { AgentProvider } from "./contract-types.js";

const execFileAsync = promisify(execFile);

/** Codex Desktop / unified ChatGPT.app bundle id (not ChatGPT Classic). */
const CODEX_BUNDLE_ID = "com.openai.codex";

/** Pull a provider session / thread id out of a streamed JSON event. */
export function extractProviderSessionId(
  parsed: Record<string, unknown>,
): string | null {
  const type = parsed["type"] as string | undefined;

  if (type === "session.configured" || type === "session_configured") {
    const id =
      (parsed["session_id"] as string | undefined) ??
      (parsed["sessionId"] as string | undefined) ??
      (parsed["thread_id"] as string | undefined) ??
      (parsed["threadId"] as string | undefined);
    if (id?.trim()) return id.trim();
  }

  if (type === "session_meta" || type === "thread.started" || type === "thread_started") {
    const payload = parsed["payload"] as Record<string, unknown> | undefined;
    const id =
      (payload?.["id"] as string | undefined) ??
      (payload?.["session_id"] as string | undefined) ??
      (payload?.["thread_id"] as string | undefined) ??
      (parsed["session_id"] as string | undefined) ??
      (parsed["thread_id"] as string | undefined) ??
      (parsed["threadId"] as string | undefined) ??
      (parsed["id"] as string | undefined);
    if (id?.trim()) return id.trim();
  }

  const thread = parsed["thread"] as Record<string, unknown> | undefined;
  const threadId =
    (thread?.["id"] as string | undefined) ??
    (parsed["thread_id"] as string | undefined) ??
    (parsed["threadId"] as string | undefined);
  if (threadId?.trim()) return threadId.trim();

  const sid =
    (parsed["session_id"] as string | undefined) ??
    (parsed["sessionId"] as string | undefined);
  if (sid?.trim()) return sid.trim();

  return null;
}

/**
 * Persist + push a newly discovered provider conversation id so:
 * - live run views can show Open in immediately
 * - finished history (passed/failed/cancelled) keeps Open in after reload
 */
export function publishProviderSession(
  runId: string,
  agentProvider: AgentProvider,
  sessionId: string,
): void {
  const trimmed = sessionId.trim();
  if (!trimmed) return;
  broadcast("run:providerSession", {
    runId,
    agentProvider,
    providerSessionId: trimmed,
  });
  void patchRunMetaProviderSession(runId, trimmed);
}

/**
 * Codex thread ids are UUIDs. Rollout filenames embed a timestamp prefix —
 * never pass that stem to `codex://threads/…` (Desktop won't resolve it).
 */
export function normalizeCodexThreadId(raw: string): string | null {
  const match = raw
    .trim()
    .match(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );
  return match ? match[0] : null;
}

/** Deep link that opens the conversation in the Codex or Claude desktop app. */
export function buildProviderSessionUrl(
  provider: AgentProvider,
  sessionId: string,
  cwd?: string,
): string {
  if (provider === "claude-code") {
    const params = new URLSearchParams({ session: sessionId });
    if (cwd?.trim()) params.set("cwd", cwd);
    return `claude://resume?${params.toString()}`;
  }
  const threadId = normalizeCodexThreadId(sessionId) ?? sessionId.trim();
  return `codex://threads/${threadId}`;
}

function codexAppSearchDirs(): string[] {
  const home = process.env.HOME?.trim();
  const dirs = ["/Applications"];
  if (home) dirs.push(path.join(home, "Applications"));
  return dirs;
}

function isCodexAppBundle(appPath: string): boolean {
  if (!existsSync(appPath)) return false;
  try {
    // Sync plutil — only used on the open-in click path.
    const out = execFileSync(
      "/usr/bin/plutil",
      [
        "-extract",
        "CFBundleIdentifier",
        "raw",
        "-o",
        "-",
        path.join(appPath, "Contents", "Info.plist"),
      ],
      { encoding: "utf-8" },
    );
    return out.trim() === CODEX_BUNDLE_ID;
  } catch {
    return false;
  }
}

/** Resolve ChatGPT.app / Codex.app with bundle id com.openai.codex. */
export function findCodexDesktopAppPath(): string | null {
  for (const dir of codexAppSearchDirs()) {
    for (const name of ["ChatGPT.app", "Codex.app"]) {
      const candidate = path.join(dir, name);
      if (isCodexAppBundle(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * Chrome runs store rollouts under an isolated CODEX_HOME. Copy the matching
 * session into the real ~/.codex so Desktop deep links can resolve it.
 */
async function ensureCodexThreadVisibleInUserHome(
  sessionId: string,
  runOutputDir: string,
): Promise<void> {
  const threadId = normalizeCodexThreadId(sessionId);
  if (!threadId) return;

  const isolatedSessions = path.join(runOutputDir, "codex-home", "sessions");
  if (!existsSync(isolatedSessions)) return;

  // Symlinked sessions already point at the user home — nothing to copy.
  try {
    const st = await fs.lstat(isolatedSessions);
    if (st.isSymbolicLink()) return;
  } catch {
    return;
  }

  const realSessions = path.join(getCodexHome(), "sessions");
  const needle = `-${threadId}.jsonl`;

  async function walk(dir: string): Promise<string | null> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = await walk(full);
        if (found) return found;
      } else if (entry.isFile() && entry.name.endsWith(needle)) {
        return full;
      }
    }
    return null;
  }

  const source = await walk(isolatedSessions);
  if (!source) return;

  const rel = path.relative(isolatedSessions, source);
  const dest = path.join(realSessions, rel);
  if (existsSync(dest)) return;

  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.copyFile(source, dest);
  console.log("[provider-session] copied Codex rollout into user home", {
    threadId,
    dest,
  });
}

async function openCodexThreadUrl(url: string): Promise<void> {
  if (process.platform === "darwin") {
    // Match the official Codex CLI / TUI handoff: `open -a <App> <url>`.
    // Electron shell.openExternal hits Launch Services without pinning the
    // com.openai.codex bundle, which races Desktop startup and surfaces a
    // transient "Conversation not found" before the thread loads.
    const appPath = findCodexDesktopAppPath();
    if (appPath) {
      await execFileAsync("/usr/bin/open", ["-a", appPath, url]);
      return;
    }
    await execFileAsync("/usr/bin/open", [url]);
    return;
  }
  await shell.openExternal(url);
}

export async function openProviderSession(
  provider: AgentProvider,
  sessionId: string,
  cwd?: string,
): Promise<void> {
  if (provider === "codex" && cwd?.trim()) {
    await ensureCodexThreadVisibleInUserHome(sessionId, cwd.trim());
  }
  const url = buildProviderSessionUrl(provider, sessionId, cwd);
  if (provider === "codex") {
    await openCodexThreadUrl(url);
    return;
  }
  await shell.openExternal(url);
}
