import { shell } from "../electron-api.js";
import { broadcast } from "../broadcast.js";
import { patchRunMetaProviderSession } from "./run-meta.js";
import type { AgentProvider } from "./contract-types.js";

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
  return `codex://threads/${sessionId}`;
}

export async function openProviderSession(
  provider: AgentProvider,
  sessionId: string,
  cwd?: string,
): Promise<void> {
  const url = buildProviderSessionUrl(provider, sessionId, cwd);
  await shell.openExternal(url);
}
