import * as os from "os";
import * as path from "path";

/**
 * Env vars injected by Claude Desktop / host SDK sessions. When inherited by
 * Story Studio (e.g. launched from a Desktop-spawned shell), they override the
 * CLI's own ~/.claude credentials with a stale OAuth token → 401 on every run.
 * Strip them so spawned `claude` uses the user's CLI login / keychain session.
 *
 * @see https://github.com/paperclipai/paperclip/issues/3930
 */
const CLAUDE_CODE_HOST_AUTH_VARS = [
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST",
  "CLAUDE_CODE_SDK_HAS_OAUTH_REFRESH",
  "CLAUDE_INTERNAL_FC_OVERRIDES",
  "CLAUDE_AGENT_SDK_VERSION",
  "CLAUDE_CODE_EXECPATH",
  // Stale bearer tokens from other tools / shells override ~/.claude credentials.
  "ANTHROPIC_AUTH_TOKEN",
  // Nesting/session vars — also strip so children don't think they're nested.
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_SESSION",
  "CLAUDE_CODE_PARENT_SESSION",
] as const;

/** Remove host-managed Claude auth vars from an env object (mutates a copy). */
export function sanitizeClaudeHostAuthEnv(
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const next = { ...env };
  for (const key of CLAUDE_CODE_HOST_AUTH_VARS) {
    delete next[key];
  }
  // Empty API key env (common in GUI-launched apps) blocks OAuth fallback.
  if (!next["ANTHROPIC_API_KEY"]?.trim()) {
    delete next["ANTHROPIC_API_KEY"];
  }
  return next;
}

/** Base spawn env shared by Codex and Claude Code child processes. */
export function buildBaseAgentSpawnEnv(): NodeJS.ProcessEnv {
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

/** Spawn env for `claude` CLI — base PATH/HOME plus stripped host OAuth vars. */
export function buildClaudeSpawnEnv(): NodeJS.ProcessEnv {
  return sanitizeClaudeHostAuthEnv(buildBaseAgentSpawnEnv());
}
