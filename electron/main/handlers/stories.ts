import * as os from "os";
import { ipcMain, dialog, shell } from "../electron-api.js";
import {
  listStories,
  getStory,
  deleteStory,
  importStories,
  exportStories,
  updateStoryVariables,
  updateStoryContent,
  renameStory,
} from "../services/stories-service.js";
import {
  listRuns,
  buildLastRunMap,
  renameRunsForStory,
  clearRuns,
} from "../services/run-service.js";

async function getLastRunMap() {
  const runs = await listRuns();
  return buildLastRunMap(runs);
}

export function registerStoriesHandlers(): void {
  ipcMain.handle("stories:list", async () => {
    const lastRunMap = await getLastRunMap();
    return listStories(lastRunMap);
  });

  ipcMain.handle("stories:get", async (_event, params: unknown) => {
    if (typeof params !== "object" || params === null || typeof (params as Record<string, unknown>)["name"] !== "string") {
      throw new Error("stories:get requires { name: string }");
    }
    const { name } = params as { name: string };
    const lastRunMap = await getLastRunMap();
    return getStory(name, lastRunMap);
  });

  ipcMain.handle("stories:delete", async (_event, params: unknown) => {
    if (typeof params !== "object" || params === null || typeof (params as Record<string, unknown>)["name"] !== "string") {
      throw new Error("stories:delete requires { name: string }");
    }
    const { name } = params as { name: string };
    await deleteStory(name);
    const lastRunMap = await getLastRunMap();
    const remaining = await listStories(lastRunMap);
    if (remaining.length === 0) {
      await clearRuns();
    }
    return { ok: true as const };
  });

  async function handleStoryUpdate(params: unknown): Promise<StoryDetail> {
    if (
      typeof params !== "object" ||
      params === null ||
      typeof (params as Record<string, unknown>)["name"] !== "string"
    ) {
      throw new Error("stories:update requires { name: string, ... }");
    }
    const p = params as Record<string, unknown>;
    const { name } = p as { name: string };
    const lastRunMap = await getLastRunMap();
    const lastRun = lastRunMap.get(name) ?? null;

    if (Array.isArray(p["steps"]) && Array.isArray(p["assertions"])) {
      if (!Array.isArray(p["variables"])) {
        throw new Error(
          "stories:update requires { name, steps, variables, assertions } for full save",
        );
      }
      return updateStoryContent(
        name,
        {
          steps: p["steps"] as string[],
          variables: p["variables"] as { key: string; value: string }[],
          assertions: p["assertions"] as string[],
        },
        lastRun,
      );
    }

    if (!Array.isArray(p["variables"])) {
      throw new Error(
        "stories:update requires { name: string, variables: {key,value}[] }",
      );
    }
    return updateStoryVariables(
      name,
      p["variables"] as { key: string; value: string }[],
      lastRun,
    );
  }

  ipcMain.handle("stories:update", async (_event, params: unknown) => {
    return handleStoryUpdate(params);
  });

  // Alias kept for renderer builds that call saveContent before main restarts.
  ipcMain.handle("stories:saveContent", async (_event, params: unknown) => {
    return handleStoryUpdate(params);
  });

  ipcMain.handle("stories:rename", async (_event, params: unknown) => {
    if (
      typeof params !== "object" ||
      params === null ||
      typeof (params as Record<string, unknown>)["name"] !== "string" ||
      typeof (params as Record<string, unknown>)["title"] !== "string"
    ) {
      throw new Error("stories:rename requires { name: string, title: string }");
    }
    const { name, title } = params as { name: string; title: string };
    const lastRunMap = await getLastRunMap();
    const detail = await renameStory(name, title.trim(), lastRunMap.get(name) ?? null);
    // Keep run history in sync — its rows display the story title.
    await renameRunsForStory(name, title.trim());
    return detail;
  });

  // Open the story's underlying site .yaml in the user's default editor.
  ipcMain.handle("stories:openFile", async (_event, params: unknown) => {
    if (
      typeof params !== "object" ||
      params === null ||
      typeof (params as Record<string, unknown>)["name"] !== "string"
    ) {
      throw new Error("stories:openFile requires { name: string }");
    }
    const { name } = params as { name: string };
    const detail = await getStory(name, new Map());
    const err = await shell.openPath(detail.filePath);
    if (err) {
      throw new Error(`Could not open YAML file: ${err}`);
    }
    return { ok: true as const };
  });

  ipcMain.handle("stories:import", async (_event, params: unknown) => {
    let filePaths: string[] | undefined;

    if (typeof params === "object" && params !== null) {
      const p = params as Record<string, unknown>;
      if (Array.isArray(p["paths"])) {
        filePaths = p["paths"].filter((x): x is string => typeof x === "string");
      }
    }

    if (!filePaths || filePaths.length === 0) {
      // Open file dialog defaulting to the user's home directory
      const defaultPath = os.homedir();
      const result = await dialog.showOpenDialog({
        title: "Import Stories",
        defaultPath,
        filters: [{ name: "YAML Files", extensions: ["yaml", "yml"] }],
        properties: ["openFile", "multiSelections"],
      });
      if (result.canceled || result.filePaths.length === 0) return [];
      filePaths = result.filePaths;
    }

    const lastRunMap = await getLastRunMap();
    return importStories(filePaths, lastRunMap);
  });

  ipcMain.handle("stories:export", async (_event, params: unknown) => {
    let destDir: string | undefined;

    if (typeof params === "object" && params !== null) {
      const p = params as Record<string, unknown>;
      if (typeof p["destDir"] === "string" && p["destDir"].trim()) {
        destDir = p["destDir"].trim();
      }
    }

    if (!destDir) {
      const result = await dialog.showOpenDialog({
        title: "Export Stories",
        defaultPath: os.homedir(),
        buttonLabel: "Export here",
        properties: ["openDirectory", "createDirectory"],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { fileCount: 0, canceled: true as const };
      }
      destDir = result.filePaths[0];
    }

    const { fileCount } = await exportStories(destDir);
    return { fileCount, canceled: false as const };
  });
}
