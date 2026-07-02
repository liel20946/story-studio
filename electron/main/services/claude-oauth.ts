import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

/** Public OAuth client id used by Claude Code CLI (from cli.js). */
const CLAUDE_OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const CLAUDE_OAUTH_TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
/** Refresh slightly before expiry so subprocess runs don't race the 8h window. */
const REFRESH_SKEW_MS = 5 * 60_000;

interface ClaudeAiOauth {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
}

interface ClaudeCredentialsFile {
  claudeAiOauth?: ClaudeAiOauth;
}

function credentialsPath(): string {
  return path.join(os.homedir(), ".claude", ".credentials.json");
}

function expiresAtMs(expiresAt: number): number {
  // Credentials may store seconds (10 digits) or milliseconds (13 digits).
  return expiresAt < 1e12 ? expiresAt * 1000 : expiresAt;
}

function oauthNeedsRefresh(oauth: ClaudeAiOauth | undefined): boolean {
  if (!oauth?.refreshToken) return false;
  if (!oauth.expiresAt) return false;
  return expiresAtMs(oauth.expiresAt) <= Date.now() + REFRESH_SKEW_MS;
}

function hasConfiguredApiKey(): boolean {
  const key = process.env.ANTHROPIC_API_KEY;
  return typeof key === "string" && key.trim().length > 0;
}

/**
 * Claude Code often fails to refresh OAuth in non-interactive subprocess mode
 * (Story Studio spawns `claude -p` with piped stdio). Proactively refresh
 * ~/.claude/.credentials.json before spawn so the child gets a valid token.
 *
 * @see https://github.com/anthropics/claude-code/issues/53063
 */
export async function ensureClaudeOAuthFresh(): Promise<void> {
  if (hasConfiguredApiKey()) return;

  let creds: ClaudeCredentialsFile;
  try {
    const raw = await fs.readFile(credentialsPath(), "utf-8");
    creds = JSON.parse(raw) as ClaudeCredentialsFile;
  } catch {
    return;
  }

  const oauth = creds.claudeAiOauth;
  if (!oauthNeedsRefresh(oauth)) return;

  try {
    const response = await fetch(CLAUDE_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: oauth!.refreshToken,
        client_id: CLAUDE_OAUTH_CLIENT_ID,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.warn("[claude:oauth] refresh failed", {
        status: response.status,
        detail: detail.slice(0, 200),
      });
      return;
    }

    const body = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!body.access_token || !body.refresh_token) {
      console.warn("[claude:oauth] refresh response missing tokens");
      return;
    }

    const updated: ClaudeCredentialsFile = {
      ...creds,
      claudeAiOauth: {
        ...oauth,
        accessToken: body.access_token,
        refreshToken: body.refresh_token,
        expiresAt: Date.now() + (body.expires_in ?? 28_800) * 1000,
      },
    };

    await fs.mkdir(path.dirname(credentialsPath()), { recursive: true });
    await fs.writeFile(credentialsPath(), JSON.stringify(updated, null, 2), "utf-8");
    console.log("[claude:oauth] refreshed OAuth access token for subprocess run");
  } catch (err) {
    console.warn(
      "[claude:oauth] refresh error",
      err instanceof Error ? err.message : String(err),
    );
  }
}
