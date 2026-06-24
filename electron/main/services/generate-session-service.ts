import * as fs from "fs/promises";
import * as path from "path";
import { randomUUID } from "crypto";
import { spawn, type ChildProcess } from "child_process";
import { broadcast } from "../broadcast.js";
import { getGenerateDir } from "./paths.js";
import { GENERATE_STORY_PLAYBOOK } from "./story-skill.js";
import { siteSlugFromUrl } from "./bowser-stories-service.js";
import { resolveCodexBinary } from "./codex-runner.js";
import { resolveClaudeBinary } from "./agent-provider.js";
import type {
  GenerateEvent,
  GenerateMessage,
  GenerateSessionDetail,
  GenerateSessionSummary,
  AgentProvider,
} from "./contract-types.js";
import { parseDraftYamlSnippet, appendApprovedStory } from "./stories-service.js";
import { promoteReviewedStory } from "./skills-python.js";

interface SessionState {
  sessionId: string;
  siteSlug: string;
  url: string;
  artifactDir: string;
  messages: GenerateMessage[];
  events: GenerateEvent[];
  eventSeq: number;
  status: GenerateSessionSummary["status"];
  process: ChildProcess | null;
  updatedAt: number;
}

const _sessions = new Map<string, SessionState>();

function sessionDir(sessionId: string): string {
  return path.join(getGenerateDir(), sessionId);
}

async function readDraftFiles(artifactDir: string): Promise<{ draftYaml?: string; draftMd?: string }> {
  try {
    const draftYaml = await fs.readFile(path.join(artifactDir, "draft.story.yaml"), "utf-8");
    const draftMd = await fs.readFile(path.join(artifactDir, "draft.story.md"), "utf-8");
    return { draftYaml, draftMd };
  } catch {
    return {};
  }
}

async function listScreenshotPaths(artifactDir: string): Promise<string[]> {
  const shotsDir = path.join(artifactDir, "screenshots");
  try {
    const files = await fs.readdir(shotsDir);
    return files.filter((f) => f.endsWith(".png")).map((f) => path.join(shotsDir, f));
  } catch {
    return [];
  }
}

function toSummary(state: SessionState): GenerateSessionSummary {
  return {
    sessionId: state.sessionId,
    siteSlug: state.siteSlug,
    url: state.url,
    status: state.status,
    updatedAt: state.updatedAt,
  };
}

async function toDetail(state: SessionState): Promise<GenerateSessionDetail> {
  const { draftYaml, draftMd } = await readDraftFiles(state.artifactDir);
  const screenshotPaths = await listScreenshotPaths(state.artifactDir);
  let draftStoryId: string | undefined;
  let draftStoryName: string | undefined;
  if (draftYaml) {
    try {
      const entry = parseDraftYamlSnippet(draftYaml);
      draftStoryId = entry.id;
      draftStoryName = entry.name;
    } catch {
      // ignore
    }
  }
  return {
    ...toSummary(state),
    artifactDir: state.artifactDir,
    messages: state.messages,
    draftYaml,
    draftMd,
    screenshotPaths,
    draftStoryId,
    draftStoryName,
  };
}

function pushMessage(state: SessionState, role: GenerateMessage["role"], content: string): void {
  state.messages.push({ id: randomUUID(), role, content, ts: Date.now() });
  state.updatedAt = Date.now();
}

function emitEvent(state: SessionState, kind: GenerateEvent["kind"], label: string, detail?: string): void {
  const event: GenerateEvent = {
    sessionId: state.sessionId,
    seq: state.eventSeq++,
    ts: Date.now(),
    kind,
    label,
    detail,
    status: "ok",
  };
  state.events.push(event);
  broadcast("generate:event", event);
}

export async function createGenerateSession(url: string, initialMessage?: string): Promise<GenerateSessionDetail> {
  const sessionId = randomUUID();
  const siteSlug = siteSlugFromUrl(url);
  const artifactDir = path.join(getGenerateDir(), sessionId);
  await fs.mkdir(path.join(artifactDir, "screenshots"), { recursive: true });

  const state: SessionState = {
    sessionId,
    siteSlug,
    url,
    artifactDir,
    messages: [],
    events: [],
    eventSeq: 0,
    status: "idle",
    process: null,
    updatedAt: Date.now(),
  };
  _sessions.set(sessionId, state);

  if (initialMessage?.trim()) {
    pushMessage(state, "user", initialMessage.trim());
  } else {
    pushMessage(state, "user", `Explore ${url} and draft a UI story for a focused user flow.`);
  }

  broadcast("generate:sessionChanged", toSummary(state));
  return toDetail(state);
}

export async function listGenerateSessions(): Promise<GenerateSessionSummary[]> {
  return [..._sessions.values()].map(toSummary).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getGenerateSession(sessionId: string): Promise<GenerateSessionDetail> {
  const state = _sessions.get(sessionId);
  if (!state) throw new Error(`Generate session not found: ${sessionId}`);
  return toDetail(state);
}

export async function sendGenerateMessage(
  sessionId: string,
  message: string,
  provider: AgentProvider,
  codexBinaryPath: string | null,
  claudeBinaryPath: string | null,
): Promise<void> {
  const state = _sessions.get(sessionId);
  if (!state) throw new Error(`Generate session not found: ${sessionId}`);
  if (state.process) throw new Error("Session is already running");

  pushMessage(state, "user", message);
  state.status = "running";
  state.updatedAt = Date.now();
  broadcast("generate:sessionChanged", toSummary(state));

  const history = state.messages.map((m) => `${m.role}: ${m.content}`).join("\n\n");
  const prompt =
    GENERATE_STORY_PLAYBOOK +
    `\n\n## Session\n` +
    `Session artifact directory: ${state.artifactDir}\n` +
    `Target URL: ${state.url}\n` +
    `Site slug: ${state.siteSlug}\n\n` +
    `Write draft.story.yaml and draft.story.md under the artifact directory after each revision.\n\n` +
    `## Conversation\n${history}`;

  const binary =
    provider === "claude-code"
      ? await resolveClaudeBinary(claudeBinaryPath)
      : await resolveCodexBinary(codexBinaryPath);

  const args =
    provider === "claude-code"
      ? ["-p", prompt, "--output-format", "json"]
      : [
          "exec",
          "--dangerously-bypass-approvals-and-sandbox",
          "--json",
          "--skip-git-repo-check",
          "-C",
          state.artifactDir,
          prompt,
        ];

  const child = spawn(binary, args, {
    cwd: state.artifactDir,
    env: { ...process.env, HOME: process.env.HOME },
    stdio: ["ignore", "pipe", "pipe"],
  });
  state.process = child;

  let buffer = "";
  let assistantText = "";

  child.stdout?.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf-8");
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        if (parsed["type"] === "item.completed") {
          const item = parsed["item"] as Record<string, unknown> | undefined;
          if (item?.["type"] === "agent_message") {
            assistantText = (item["text"] as string) ?? assistantText;
          }
          if (item?.["type"] === "tool_call") {
            const toolName = (item["tool"] as string | undefined) ?? "tool";
            emitEvent(state, "tool", toolName, JSON.stringify(item["arguments"] ?? "").slice(0, 120));
          }
        }
      } catch {
        assistantText += line + "\n";
      }
    }
  });

  child.on("close", async () => {
    state.process = null;
    if (assistantText.trim()) {
      pushMessage(state, "assistant", assistantText.trim());
    }
    state.status = "ready";
    state.updatedAt = Date.now();
    broadcast("generate:sessionChanged", toSummary(state));
    broadcast("generate:draftUpdated", { sessionId: state.sessionId });
  });

  child.on("error", (err) => {
    state.process = null;
    state.status = "ready";
    pushMessage(state, "assistant", `Error: ${err.message}`);
    broadcast("generate:sessionChanged", toSummary(state));
  });
}

export async function cancelGenerateSession(sessionId: string): Promise<void> {
  const state = _sessions.get(sessionId);
  if (!state?.process) return;
  state.process.kill("SIGTERM");
  state.process = null;
  state.status = "ready";
}

export async function saveGenerateSession(sessionId: string): Promise<{ storyName: string }> {
  const state = _sessions.get(sessionId);
  if (!state) throw new Error(`Generate session not found: ${sessionId}`);

  await promoteReviewedStory(state.artifactDir);
  const draftYaml = await fs.readFile(path.join(state.artifactDir, "draft.story.yaml"), "utf-8");
  const entry = parseDraftYamlSnippet(draftYaml);
  entry.mode = "generated";
  const storyName = await appendApprovedStory(state.siteSlug, entry);
  state.status = "saved";
  state.updatedAt = Date.now();
  broadcast("generate:sessionChanged", toSummary(state));
  return { storyName };
}

export async function discardGenerateSession(sessionId: string): Promise<void> {
  const state = _sessions.get(sessionId);
  if (!state) return;
  if (state.process) state.process.kill("SIGTERM");
  await fs.rm(state.artifactDir, { recursive: true, force: true });
  state.status = "discarded";
  _sessions.delete(sessionId);
  broadcast("generate:sessionChanged", toSummary(state));
}
