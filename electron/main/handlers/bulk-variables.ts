import { randomUUID } from "crypto";
import { ipcMain } from "../electron-api.js";
import {
  cancelBulkVariablesGenerate,
  generateBulkVariableRuns,
} from "../services/bulk-variables-service.js";
import { getSettingsValue } from "./settings.js";

export function registerBulkVariablesHandlers(): void {
  ipcMain.handle("bulk:generateVariables", async (_event, params: unknown) => {
    if (
      typeof params !== "object" ||
      params === null ||
      typeof (params as Record<string, unknown>)["storyName"] !== "string" ||
      typeof (params as Record<string, unknown>)["description"] !== "string"
    ) {
      throw new Error("bulk:generateVariables requires { storyName: string; description: string }");
    }
    const { storyName, description, invocationId } = params as {
      storyName: string;
      description: string;
      invocationId?: string;
    };
    const settings = getSettingsValue();
    const id = invocationId?.trim() || randomUUID();
    const result = await generateBulkVariableRuns(
      storyName,
      description,
      settings,
      id,
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
