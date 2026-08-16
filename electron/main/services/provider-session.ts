import { shell } from "../electron-api.js";
import type { AgentProvider } from "./contract-types.js";

/** Pull a provider session / thread id out of a streamed JSON event. */
export function extractProviderSessionId(
  parsed: Record<string, unknown>,
): string | null {
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

  const sid =
    (parsed["session_id"] as string | undefined) ??
    (parsed["sessionId"] as string | undefined);
  if (sid?.trim()) return sid.trim();

  return null;
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
