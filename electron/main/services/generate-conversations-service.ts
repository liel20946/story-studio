import * as fs from "fs/promises";
import * as path from "path";
import { randomUUID } from "crypto";
import { app } from "../electron-api.js";
import { broadcast } from "../broadcast.js";
import type {
  GenerateConversation,
  GenerateConversationSummary,
  GenerateMessage,
} from "./contract-types.js";

let _conversationsDir: string | null = null;

export function getGenerateConversationsDir(): string {
  if (!_conversationsDir) {
    throw new Error("generate conversations dir not initialized — call initGenerateConversationsDir() first");
  }
  return _conversationsDir;
}

export async function initGenerateConversationsDir(): Promise<void> {
  _conversationsDir = path.join(app.getPath("userData"), "generate-conversations");
  await fs.mkdir(_conversationsDir, { recursive: true });
}

function conversationPath(id: string): string {
  return path.join(getGenerateConversationsDir(), `${id}.json`);
}

export async function loadConversation(id: string): Promise<GenerateConversation | null> {
  try {
    const raw = await fs.readFile(conversationPath(id), "utf-8");
    return JSON.parse(raw) as GenerateConversation;
  } catch {
    return null;
  }
}

export async function saveConversation(conversation: GenerateConversation): Promise<void> {
  conversation.updatedAt = Date.now();
  await fs.writeFile(conversationPath(conversation.id), JSON.stringify(conversation, null, 2), "utf-8");
}

export async function listConversationSummaries(): Promise<GenerateConversationSummary[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(getGenerateConversationsDir());
  } catch {
    return [];
  }

  const summaries: GenerateConversationSummary[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const id = entry.replace(/\.json$/, "");
    const conversation = await loadConversation(id);
    if (!conversation) continue;
    if (!conversation.messages.some((m) => m.kind === "user")) continue;
    summaries.push({
      id: conversation.id,
      title: conversation.title,
      status: conversation.status,
      storyName: conversation.storyName,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      generating: conversation.generating ?? false,
    });
  }

  return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function createConversation(): Promise<GenerateConversation> {
  const now = Date.now();
  const conversation: GenerateConversation = {
    id: randomUUID(),
    title: "New generation",
    status: "active",
    draftId: "",
    createdAt: now,
    updatedAt: now,
    messages: [],
    generating: false,
  };
  await saveConversation(conversation);
  return conversation;
}

export function buildTranscript(messages: GenerateMessage[]): string {
  return messages
    .filter((m) => m.kind === "user" || m.kind === "draft" || m.kind === "error")
    .map((m) => {
      if (m.kind === "user") return `User: ${m.text}`;
      if (m.kind === "assistant") return `Assistant: ${m.text}`;
      if (m.kind === "error") return `Assistant (error): ${m.text}`;
      return `Assistant (draft): ${m.storyTitle} — ${m.summary}`;
    })
    .join("\n");
}

export async function appendMessage(
  conversationId: string,
  message: GenerateMessage,
): Promise<GenerateConversation> {
  const conversation = await loadConversation(conversationId);
  if (!conversation) throw new Error(`Conversation not found: ${conversationId}`);
  conversation.messages.push(message);
  await saveConversation(conversation);
  return conversation;
}

export async function updateConversationTitle(
  conversationId: string,
  title: string,
): Promise<GenerateConversation> {
  const trimmed = title.trim();
  if (!trimmed) throw new Error("Title cannot be empty");
  const conversation = await loadConversation(conversationId);
  if (!conversation) throw new Error(`Conversation not found: ${conversationId}`);
  conversation.title = trimmed;
  await saveConversation(conversation);
  return conversation;
}

export async function setConversationGenerating(
  conversationId: string,
  generating: boolean,
): Promise<GenerateConversation> {
  const conversation = await loadConversation(conversationId);
  if (!conversation) throw new Error(`Conversation not found: ${conversationId}`);
  conversation.generating = generating;
  await saveConversation(conversation);
  return conversation;
}

export async function completeConversation(
  conversationId: string,
  storyName: string,
): Promise<GenerateConversation> {
  const conversation = await loadConversation(conversationId);
  if (!conversation) throw new Error(`Conversation not found: ${conversationId}`);
  conversation.status = "complete";
  conversation.storyName = storyName;
  conversation.generating = false;
  await saveConversation(conversation);
  return conversation;
}

export async function deleteConversation(conversationId: string): Promise<void> {
  try {
    await fs.unlink(conversationPath(conversationId));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw err;
  }
}

/** Clear stale generating flags left when the app restarts mid-generation. */
export async function recoverOrphanedGenerations(): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.readdir(getGenerateConversationsDir());
  } catch {
    return;
  }

  let changed = false;
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const id = entry.replace(/\.json$/, "");
    const conversation = await loadConversation(id);
    if (!conversation?.generating) continue;
    conversation.generating = false;
    await saveConversation(conversation);
    changed = true;
    console.log("[generate:recovery] cleared stale generating flag", { conversationId: id });
  }

  if (changed) {
    broadcast("generate:changed", await listConversationSummaries());
  }
}
