import * as os from "os";
import * as fs from "fs/promises";
import { randomUUID } from "crypto";
import { ipcMain, dialog, BrowserWindow } from "../electron-api.js";
import {
  cancelBulkVariablesGenerate,
  generateBulkVariableRuns,
} from "../services/bulk-variables-service.js";
import { mockRunsEnabled } from "../services/mock-runner.js";
import { getSettingsValue } from "./settings.js";
import { getMainWindow } from "../windows/main-window.js";
import { broadcast } from "../broadcast.js";

function mockAttachmentPathsFromEnv(): string[] {
  const raw = process.env.STORY_STUDIO_MOCK_ATTACHMENTS?.trim();
  if (!raw) return [];
  return raw
    .split(/[:;]/)
    .map((p) => p.trim())
    .filter(Boolean);
}

async function pickContextPaths(
  parentWindow: ReturnType<typeof BrowserWindow.fromWebContents>,
  mode: "files" | "folder",
): Promise<{
  paths: string[];
  canceled: boolean;
}> {
  if (mockRunsEnabled()) {
    const mockPaths = mockAttachmentPathsFromEnv();
    if (mockPaths.length > 0) {
      const filtered: string[] = [];
      for (const p of mockPaths) {
        try {
          const st = await fs.stat(p);
          if (mode === "folder" ? st.isDirectory() : st.isFile()) {
            filtered.push(p);
          }
        } catch {
          // skip missing mock paths
        }
      }
      if (filtered.length > 0) {
        return { paths: filtered, canceled: false };
      }
    }
  }

  const win = parentWindow ?? getMainWindow() ?? undefined;
  const dialogOpts = {
    title: mode === "folder" ? "Attach folder" : "Attach files",
    defaultPath: os.homedir(),
    buttonLabel: "Attach",
    properties:
      mode === "folder"
        ? (["openDirectory"] as Array<"openDirectory">)
        : (["openFile", "multiSelections"] as Array<"openFile" | "multiSelections">),
    filters:
      mode === "folder"
        ? undefined
        : [
            {
              name: "Text & web",
              extensions: [
                "html",
                "htm",
                "txt",
                "md",
                "json",
                "csv",
                "xml",
                "yaml",
                "yml",
              ],
            },
            { name: "All files", extensions: ["*"] },
          ],
  };
  const result = win
    ? await dialog.showOpenDialog(win, dialogOpts)
    : await dialog.showOpenDialog(dialogOpts);
  if (result.canceled || result.filePaths.length === 0) {
    return { paths: [], canceled: true };
  }
  return { paths: result.filePaths, canceled: false };
}

export function registerBulkVariablesHandlers(): void {
  ipcMain.handle("bulk:pickContextPaths", async (event, params: unknown) => {
    const mode =
      typeof params === "object" &&
      params !== null &&
      ((params as Record<string, unknown>)["mode"] === "folder" ||
        (params as Record<string, unknown>)["mode"] === "files")
        ? ((params as { mode: "files" | "folder" }).mode)
        : "files";
    return pickContextPaths(BrowserWindow.fromWebContents(event.sender), mode);
  });

  ipcMain.handle("bulk:generateVariables", async (_event, params: unknown) => {
    if (
      typeof params !== "object" ||
      params === null ||
      typeof (params as Record<string, unknown>)["storyName"] !== "string" ||
      typeof (params as Record<string, unknown>)["description"] !== "string"
    ) {
      throw new Error("bulk:generateVariables requires { storyName: string; description: string }");
    }
    const { storyName, description, invocationId, contextPaths } = params as {
      storyName: string;
      description: string;
      invocationId?: string;
      contextPaths?: unknown;
    };
    const paths = Array.isArray(contextPaths)
      ? contextPaths.filter((p): p is string => typeof p === "string" && p.trim().length > 0)
      : [];
    const settings = getSettingsValue();
    const id = invocationId?.trim() || randomUUID();
    const result = await generateBulkVariableRuns(
      storyName,
      description,
      settings,
      id,
      (message) => {
        broadcast("bulk:generateProgress", { invocationId: id, message });
      },
      { contextPaths: paths },
    );
    return { invocationId: id, ...result };
  });

  ipcMain.handle("bulk:cancelGenerateVariables", async (_event, params: unknown) => {
    if (
      typeof params !== "object" ||
      params === null ||
      typeof (params as Record<string, unknown>)["invocationId"] !== "string"
    ) {
      throw new Error("bulk:cancelGenerateVariables requires { invocationId: string }");
    }
    const { invocationId } = params as { invocationId: string };
    return { ok: cancelBulkVariablesGenerate(invocationId) };
  });
}
