import { ipcMain } from "../electron-api.js";
import { getSettingsValue } from "./settings.js";
import {
  createGenerateSession,
  listGenerateSessions,
  getGenerateSession,
  sendGenerateMessage,
  cancelGenerateSession,
  saveGenerateSession,
  discardGenerateSession,
} from "../services/generate-session-service.js";

export function registerGenerateHandlers(): void {
  ipcMain.handle("generate:create", async (_event, params: unknown) => {
    if (typeof params !== "object" || params === null || typeof (params as Record<string, unknown>)["url"] !== "string") {
      throw new Error("generate:create requires { url: string, message?: string }");
    }
    const { url, message } = params as { url: string; message?: string };
    return createGenerateSession(url, message);
  });

  ipcMain.handle("generate:list", async () => listGenerateSessions());

  ipcMain.handle("generate:get", async (_event, params: unknown) => {
    if (typeof params !== "object" || params === null || typeof (params as Record<string, unknown>)["sessionId"] !== "string") {
      throw new Error("generate:get requires { sessionId: string }");
    }
    const { sessionId } = params as { sessionId: string };
    return getGenerateSession(sessionId);
  });

  ipcMain.handle("generate:send", async (_event, params: unknown) => {
    if (
      typeof params !== "object" ||
      params === null ||
      typeof (params as Record<string, unknown>)["sessionId"] !== "string" ||
      typeof (params as Record<string, unknown>)["message"] !== "string"
    ) {
      throw new Error("generate:send requires { sessionId: string, message: string }");
    }
    const { sessionId, message } = params as { sessionId: string; message: string };
    const settings = getSettingsValue();
    await sendGenerateMessage(
      sessionId,
      message,
      settings.agentProvider,
      settings.codexBinaryPath,
      settings.claudeBinaryPath,
    );
    return { ok: true as const };
  });

  ipcMain.handle("generate:cancel", async (_event, params: unknown) => {
    if (typeof params !== "object" || params === null || typeof (params as Record<string, unknown>)["sessionId"] !== "string") {
      throw new Error("generate:cancel requires { sessionId: string }");
    }
    const { sessionId } = params as { sessionId: string };
    await cancelGenerateSession(sessionId);
    return { ok: true as const };
  });

  ipcMain.handle("generate:save", async (_event, params: unknown) => {
    if (typeof params !== "object" || params === null || typeof (params as Record<string, unknown>)["sessionId"] !== "string") {
      throw new Error("generate:save requires { sessionId: string }");
    }
    const { sessionId } = params as { sessionId: string };
    return saveGenerateSession(sessionId);
  });

  ipcMain.handle("generate:discard", async (_event, params: unknown) => {
    if (typeof params !== "object" || params === null || typeof (params as Record<string, unknown>)["sessionId"] !== "string") {
      throw new Error("generate:discard requires { sessionId: string }");
    }
    const { sessionId } = params as { sessionId: string };
    await discardGenerateSession(sessionId);
    return { ok: true as const };
  });
}
