import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { stringify as stringifyYaml } from "yaml";
import { broadcast } from "../broadcast.js";
import type { AgentProvider, GenerateConversation, GenerateMessage } from "./contract-types.js";
import { getAgentRunConfig } from "./agent-config.js";
import { resolveAgentBinary } from "./agent-provider.js";
import {
  acquirePlaywrightSlot,
  releasePlaywrightSlot,
} from "./playwright-slots.js";
import {
  normalizeBowserEntryForStorage,
  slugify,
  storyEntryToMarkdown,
  validateBowserEntry,
  type BowserStoryEntry,
} from "./bowser-stories-service.js";
import {
  appendMessage,
  buildTranscript,
  completeConversation,
  loadConversation,
  listConversationSummaries,
  saveConversation,
  setConversationGenerating,
  updateConversationTitle,
} from "./generate-conversations-service.js";
import { createDraftDir, parseDraftYamlSnippet, saveDraftToLibrary } from "./stories-service.js";
import { getDraftsDir } from "./paths.js";
import { buildGeneratePrompt } from "./story-skill.js";
import {
  cancelGenerateInvocation,
  GenerateCancelledError,
  invokeGenerateAgent,
  parseGeneratedYaml,
} from "./agent-generate-runner.js";
import { listStories } from "./stories-service.js";
import { listRuns, buildLastRunMap } from "./run-service.js";

function extractUrlFromText(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s<>"')\]]+/i);
  return match?.[0] ?? null;
}

function siteSlugFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    const pathPart = parsed.pathname === "/" ? "" : parsed.pathname;
    return slugify(`${host}${pathPart}`) || "generated-site";
  } catch {
    return "generated-site";
  }
}

function summarizeEntry(entry: BowserStoryEntry): string {
  const workflow = entry.workflow?.trim() ?? "";
  const firstLines = workflow
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(" · ");
  return firstLines || entry.name || "Generated story draft";
}

function normalizeGeneratedEntry(
  entry: BowserStoryEntry,
  url: string,
): BowserStoryEntry {
  const normalized = normalizeBowserEntryForStorage({
    ...entry,
    url: entry.url?.trim() || url,
    mode: "generated",
  });
  if (!normalized.id?.trim()) {
    normalized.id = slugify(normalized.name || "generated-flow");
  }
  const errors = validateBowserEntry(normalized);
  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }
  return normalized;
}

async function writeDraftArtifacts(
  draftDir: string,
  entry: BowserStoryEntry,
): Promise<{ draftYaml: string; draftMd: string }> {
  const draftYaml = stringifyYaml({ stories: [entry] });
  const draftMd = storyEntryToMarkdown(entry);
  await fs.writeFile(path.join(draftDir, "draft.story.yaml"), draftYaml, "utf-8");
  await fs.writeFile(path.join(draftDir, "draft.story.md"), draftMd, "utf-8");
  return { draftYaml, draftMd };
}

async function broadcastChanged(): Promise<void> {
  const summaries = await listConversationSummaries();
  broadcast("generate:changed", summaries);
}

function isProseAgentResponse(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/^stories:\s*$/m.test(trimmed)) return false;
  if (/```ya?ml/i.test(trimmed)) return false;
  return true;
}

function friendlyGenerationError(raw: string, agentMessage?: string): string {
  if (agentMessage && isProseAgentResponse(agentMessage)) {
    return agentMessage.trim();
  }
  if (raw.includes("Implicit keys") || raw.includes("Invalid draft YAML")) {
    return "The agent didn't return a valid story draft. Reply in chat with any missing details (e.g. login email) and try again.";
  }
  return raw;
}

function buildTitlePrompt(userMessage: string): string {
  return `Summarize this UI test story request as a short chat title (3-8 words).
Rules: reply with ONLY the title text; no quotes; no trailing period; do not copy the full message verbatim.

Request:
${userMessage}`;
}

function parseTitleFromAgentResponse(raw: string): string | null {
  const line = raw.trim().split("\n")[0]?.trim() ?? "";
  const stripped = line.replace(/^["'`]+|["'`]+$/g, "").replace(/\.$/, "").trim();
  if (!stripped || stripped.length > 80) return null;
  return stripped;
}

type GenerateSettings = {
  agentProvider: AgentProvider;
  codexBinaryPath: string | null;
  claudeBinaryPath: string | null;
  codexModel: string;
  codexEffort: string;
  claudeModel: string;
  claudeEffort: string;
};

async function suggestConversationTitle(
  conversationId: string,
  userMessage: string,
  settings: GenerateSettings,
): Promise<void> {
  const outputDir = path.join(os.tmpdir(), "story-studio-titles", conversationId);
  await fs.mkdir(outputDir, { recursive: true });

  const agentBinary = await resolveAgentBinary(
    settings.agentProvider,
    settings.codexBinaryPath,
    settings.claudeBinaryPath,
  );
  const agentConfig = getAgentRunConfig(settings.agentProvider, settings);

  const raw = await invokeGenerateAgent({
    conversationId,
    invocationId: `${conversationId}:title`,
    prompt: buildTitlePrompt(userMessage),
    outputDir,
    provider: settings.agentProvider,
    agentBinary,
    agentConfig,
    exploring: false,
  });

  const title = parseTitleFromAgentResponse(raw);
  if (title) {
    await updateConversationTitle(conversationId, title);
  }
}

const _activeGenerations = new Map<string, { playwrightHeld: boolean }>();

export async function cancelGenerate(conversationId: string): Promise<boolean> {
  cancelGenerateInvocation(conversationId);
  cancelGenerateInvocation(`${conversationId}:title`);

  const session = _activeGenerations.get(conversationId);
  if (session?.playwrightHeld) {
    releasePlaywrightSlot();
    session.playwrightHeld = false;
  }

  const conversation = await loadConversation(conversationId);
  if (!conversation?.generating) return false;

  await setConversationGenerating(conversationId, false);
  await broadcastChanged();
  return true;
}

export async function sendGenerateMessage(
  conversationId: string,
  text: string,
  settings: GenerateSettings,
): Promise<GenerateConversation> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Message cannot be empty");

  const conversation = await loadConversation(conversationId);
  if (!conversation) throw new Error(`Conversation not found: ${conversationId}`);
  if (conversation.status === "complete") {
    throw new Error("This generation is already complete.");
  }
  if (conversation.generating) {
    throw new Error("A generation is already in progress for this conversation.");
  }

  const userCount = conversation.messages.filter((m) => m.kind === "user").length;
  const isFirstTurn = userCount === 0;
  const exploring = isFirstTurn;

  if (isFirstTurn) {
    const url = extractUrlFromText(trimmed);
    if (!url) {
      const errorMsg: GenerateMessage = {
        kind: "error",
        text: "Include a target URL in your message (e.g. https://example.com).",
        at: Date.now(),
      };
      await appendMessage(conversationId, { kind: "user", text: trimmed, at: Date.now() });
      void suggestConversationTitle(conversationId, trimmed, settings)
        .then(() => broadcastChanged())
        .catch(() => {
          // keep default title
        });
      await appendMessage(conversationId, errorMsg);
      await broadcastChanged();
      return (await loadConversation(conversationId))!;
    }
  }

  await appendMessage(conversationId, { kind: "user", text: trimmed, at: Date.now() });
  if (isFirstTurn) {
    void suggestConversationTitle(conversationId, trimmed, settings)
      .then(() => broadcastChanged())
      .catch(() => {
        // keep default title
      });
  }
  await setConversationGenerating(conversationId, true);
  broadcast("generate:progress", {
    conversationId,
    message: exploring ? "Planning next moves" : "Reviewing your draft",
  });
  await broadcastChanged();

  const refreshed = (await loadConversation(conversationId))!;
  const transcript = buildTranscript(
    refreshed.messages.filter((m) => m.kind !== "status"),
  );

  let currentDraftYaml: string | undefined;
  if (refreshed.draftId) {
    try {
      currentDraftYaml = await fs.readFile(
        path.join(getDraftsDir(), refreshed.draftId, "draft.story.yaml"),
        "utf-8",
      );
    } catch {
      if (!isFirstTurn) {
        throw new Error("Draft files are missing — cannot revise.");
      }
    }
  }

  const prompt = buildGeneratePrompt({
    userMessage: trimmed,
    transcript,
    currentDraftYaml,
    isFirstTurn,
  });

  const agentBinary = await resolveAgentBinary(
    settings.agentProvider,
    settings.codexBinaryPath,
    settings.claudeBinaryPath,
  );
  const agentConfig = getAgentRunConfig(settings.agentProvider, settings);

  let draftDir = refreshed.draftId
    ? path.join(getDraftsDir(), refreshed.draftId)
    : "";
  if (!draftDir) {
    const url = extractUrlFromText(trimmed)!;
    draftDir = await createDraftDir(siteSlugFromUrl(url));
    const conv = await loadConversation(conversationId);
    if (conv) {
      conv.draftId = path.basename(draftDir);
      await saveConversation(conv);
    }
  }

  let playwrightHeld = false;
  let agentMessage = "";
  _activeGenerations.set(conversationId, { playwrightHeld: false });
  try {
    if (exploring) {
      await acquirePlaywrightSlot();
      playwrightHeld = true;
      _activeGenerations.set(conversationId, { playwrightHeld: true });
    }

    agentMessage = await invokeGenerateAgent({
      conversationId,
      prompt,
      outputDir: draftDir,
      provider: settings.agentProvider,
      agentBinary,
      agentConfig,
      exploring,
      onProgress: (message) => {
        broadcast("generate:progress", { conversationId, message });
      },
    });

    const yamlSnippet = parseGeneratedYaml(agentMessage);
    const entry = parseDraftYamlSnippet(yamlSnippet);
    const url = extractUrlFromText(trimmed) ?? entry.url ?? "https://example.com";
    const normalized = normalizeGeneratedEntry(entry, url);
    await writeDraftArtifacts(draftDir, normalized);

    const draftMessage: GenerateMessage = {
      kind: "draft",
      at: Date.now(),
      storyTitle: normalized.name,
      summary: summarizeEntry(normalized),
    };
    await appendMessage(conversationId, draftMessage);
  } catch (err) {
    if (err instanceof GenerateCancelledError) {
      // User stopped generation — no error bubble.
    } else {
      const raw = err instanceof Error ? err.message : String(err);
      const display = friendlyGenerationError(raw, agentMessage);
      const kind: GenerateMessage["kind"] =
        agentMessage && isProseAgentResponse(agentMessage) ? "assistant" : "error";
      await appendMessage(conversationId, { kind, text: display, at: Date.now() });
    }
  } finally {
    _activeGenerations.delete(conversationId);
    if (playwrightHeld) releasePlaywrightSlot();
    const current = await loadConversation(conversationId);
    if (current?.generating) {
      await setConversationGenerating(conversationId, false);
    }
    await broadcastChanged();
  }

  return (await loadConversation(conversationId))!;
}

export async function approveGenerateConversation(conversationId: string): Promise<{
  storyName: string;
  conversation: GenerateConversation;
}> {
  const conversation = await loadConversation(conversationId);
  if (!conversation) throw new Error(`Conversation not found: ${conversationId}`);
  if (conversation.status === "complete") {
    throw new Error("This generation is already complete.");
  }
  if (!conversation.draftId) {
    throw new Error("No draft to approve yet.");
  }

  const draftDir = path.join(getDraftsDir(), conversation.draftId);
  const draftYaml = await fs.readFile(path.join(draftDir, "draft.story.yaml"), "utf-8");
  const entry = parseDraftYamlSnippet(draftYaml);
  const siteSlug = siteSlugFromUrl(entry.url ?? "https://example.com");

  const storyName = await saveDraftToLibrary(draftDir, siteSlug, entry.id);
  const completed = await completeConversation(conversationId, storyName);

  const runs = await listRuns();
  const summaries = await listStories(buildLastRunMap(runs));
  broadcast("stories:changed", summaries);
  await broadcastChanged();

  return { storyName, conversation: completed };
}
