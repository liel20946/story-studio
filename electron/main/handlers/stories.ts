import * as os from "os";
import { ipcMain, dialog, shell } from "../electron-api.js";
import {
  listStories,
  getStory,
  deleteStory,
  importStories,
  updateStoryVariables,
  renameStory,
} from "../services/stories-service.js";
import { listRuns, buildLastRunMap, renameRunsForStory } from "../services/run-service.js";

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
    return { ok: true as const };
  });

  ipcMain.handle("stories:update", async (_event, params: unknown) => {
    if (
      typeof params !== "object" ||
      params === null ||
      typeof (params as Record<string, unknown>)["name"] !== "string" ||
      !Array.isArray((params as Record<string, unknown>)["variables"])
    ) {
      throw new Error(
        "stories:update requires { name: string, variables: {key,value}[] }",
      );
    }
    const { name, variables } = params as {
      name: string;
      variables: { key: string; value: string }[];
    };
    const lastRunMap = await getLastRunMap();
    return updateStoryVariables(name, variables, lastRunMap.get(name) ?? null);
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

  // Open the story's underlying .story.md in the user's default editor so they
  // can edit steps / assertions / frontmatter directly (the "Edit" action).
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
      throw new Error(`Could not open story file: ${err}`);
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
        filters: [{ name: "Story Files", extensions: ["story.md", "md"] }],
        properties: ["openFile", "multiSelections"],
      });
      if (result.canceled || result.filePaths.length === 0) return [];
      filePaths = result.filePaths;
    }

    const lastRunMap = await getLastRunMap();
    return importStories(filePaths, lastRunMap);
  });
}
