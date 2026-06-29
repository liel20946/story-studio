import * as fs from "fs/promises";
import * as path from "path";
import { ipcMain } from "../electron-api.js";
import { broadcast } from "../broadcast.js";
import {
  listConversationSummaries,
  createConversation,
  loadConversation,
  deleteConversation,
  updateConversationTitle,
} from "../services/generate-conversations-service.js";
import {
  sendGenerateMessage,
  approveGenerateConversation,
  cancelGenerate,
  type AgentModelOverride,
} from "../services/story-generate-service.js";
import { readDraftArtifact } from "../services/stories-service.js";
import { getDraftsDir } from "../services/paths.js";
import { getSettingsValue } from "./settings.js";
import type { GenerateConversationDetail } from "../services/contract-types.js";

export function registerGenerateHandlers(): void {
  ipcMain.handle("generate:list", async () => listConversationSummaries());

  ipcMain.handle("generate:create", async () => {
    const conversation = await createConversation();
    const summaries = await listConversationSummaries();
    broadcast("generate:changed", summaries);
    return conversation;
  });

  ipcMain.handle("generate:get", async (_event, params: unknown) => {
    if (
      typeof params !== "object" ||
      params === null ||
      typeof (params as Record<string, unknown>)["conversationId"] !== "string"
    ) {
      throw new Error("generate:get requires { conversationId: string }");
    }
    const { conversationId } = params as { conversationId: string };
    const conversation = await loadConversation(conversationId);
    if (!conversation) throw new Error(`Conversation not found: ${conversationId}`);

    const detail: GenerateConversationDetail = { ...conversation };
    if (conversation.draftId) {
      const draftDir = path.join(getDraftsDir(), conversation.draftId);
      try {
        const artifacts = await readDraftArtifact(draftDir);
        detail.draftMd = artifacts.draftMd;
        detail.draftYaml = artifacts.draftYaml;
      } catch {
        // draft may have been promoted
      }
    }
    return detail;
  });

  ipcMain.handle("generate:send", async (_event, params: unknown) => {
    if (
      typeof params !== "object" ||
      params === null ||
      typeof (params as Record<string, unknown>)["conversationId"] !== "string" ||
      typeof (params as Record<string, unknown>)["text"] !== "string"
    ) {
      throw new Error("generate:send requires { conversationId: string; text: string }");
    }
    const { conversationId, text, modelOverride } = params as {
      conversationId: string;
      text: string;
      modelOverride?: AgentModelOverride;
    };
    const settings = getSettingsValue();
    const conversation = await sendGenerateMessage(conversationId, text, settings, modelOverride);
    return { ok: true as const, conversation };
  });

  ipcMain.handle("generate:approve", async (_event, params: unknown) => {
    if (
      typeof params !== "object" ||
      params === null ||
      typeof (params as Record<string, unknown>)["conversationId"] !== "string"
    ) {
      throw new Error("generate:approve requires { conversationId: string }");
    }
    const { conversationId } = params as { conversationId: string };
    const result = await approveGenerateConversation(conversationId);
    return { ok: true as const, storyName: result.storyName, conversation: result.conversation };
  });

  ipcMain.handle("generate:cancel", async (_event, params: unknown) => {
    if (
      typeof params !== "object" ||
      params === null ||
      typeof (params as Record<string, unknown>)["conversationId"] !== "string"
    ) {
      throw new Error("generate:cancel requires { conversationId: string }");
    }
    const { conversationId } = params as { conversationId: string };
    const cancelled = await cancelGenerate(conversationId);
    return { ok: true as const, cancelled };
  });

  ipcMain.handle("generate:delete", async (_event, params: unknown) => {
    if (
      typeof params !== "object" ||
      params === null ||
      typeof (params as Record<string, unknown>)["conversationId"] !== "string"
    ) {
      throw new Error("generate:delete requires { conversationId: string }");
    }
    const { conversationId } = params as { conversationId: string };
    await cancelGenerate(conversationId);
    await deleteConversation(conversationId);
    const summaries = await listConversationSummaries();
    broadcast("generate:changed", summaries);
    return { ok: true as const };
  });

  ipcMain.handle("generate:rename", async (_event, params: unknown) => {
    if (
      typeof params !== "object" ||
      params === null ||
      typeof (params as Record<string, unknown>)["conversationId"] !== "string" ||
      typeof (params as Record<string, unknown>)["title"] !== "string"
    ) {
      throw new Error("generate:rename requires { conversationId: string; title: string }");
    }
    const { conversationId, title } = params as { conversationId: string; title: string };
    const conversation = await updateConversationTitle(conversationId, title);
    const summaries = await listConversationSummaries();
    broadcast("generate:changed", summaries);
    return { ok: true as const, conversation };
  });
}
