import * as fs from "fs/promises";
import * as path from "path";
import { ipcMain } from "../electron-api.js";
import {
  readDraftArtifact,
  discardDraftDir,
  saveDraftToLibrary,
  listStories,
  parseDraftYamlSnippet,
} from "../services/stories-service.js";
import { getDraftsDir } from "../services/paths.js";
import { listRuns, buildLastRunMap } from "../services/run-service.js";
import { broadcast } from "../broadcast.js";
import type { StoryDraft } from "../services/contract-types.js";

async function listDraftSummaries(): Promise<StoryDraft[]> {
  const dir = getDraftsDir();
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  const drafts: StoryDraft[] = [];
  for (const entry of entries) {
    const artifactDir = path.join(dir, entry);
    try {
      const stat = await fs.stat(artifactDir);
      if (!stat.isDirectory()) continue;
      const draftMdPath = path.join(artifactDir, "draft.story.md");
      await fs.access(draftMdPath);
      const siteSlug = entry.split("-")[0] ?? entry;
      drafts.push({
        draftId: entry,
        siteSlug,
        artifactDir,
        draftMdPath,
        draftYamlPath: path.join(artifactDir, "draft.story.yaml"),
        recordingSpecPath: path.join(artifactDir, "recording.spec.ts"),
        createdAt: stat.birthtimeMs > 0 ? stat.birthtimeMs : stat.mtimeMs,
      });
    } catch {
      // skip incomplete
    }
  }
  return drafts.sort((a, b) => b.createdAt - a.createdAt);
}

export function registerDraftHandlers(): void {
  ipcMain.handle("drafts:list", async () => listDraftSummaries());

  ipcMain.handle("drafts:get", async (_event, params: unknown) => {
    if (typeof params !== "object" || params === null || typeof (params as Record<string, unknown>)["draftId"] !== "string") {
      throw new Error("drafts:get requires { draftId: string }");
    }
    const { draftId } = params as { draftId: string };
    const artifactDir = path.join(getDraftsDir(), draftId);
    const artifacts = await readDraftArtifact(artifactDir);
    const drafts = await listDraftSummaries();
    const meta = drafts.find((d) => d.draftId === draftId);
    if (!meta) throw new Error(`Draft not found: ${draftId}`);
    return { ...meta, ...artifacts };
  });

  ipcMain.handle("drafts:approve", async (_event, params: unknown) => {
    if (typeof params !== "object" || params === null || typeof (params as Record<string, unknown>)["draftId"] !== "string") {
      throw new Error("drafts:approve requires { draftId: string }");
    }
    const { draftId } = params as { draftId: string };
    const artifactDir = path.join(getDraftsDir(), draftId);
    const drafts = await listDraftSummaries();
    const meta = drafts.find((d) => d.draftId === draftId);
    if (!meta) throw new Error(`Draft not found: ${draftId}`);

    const artifacts = await readDraftArtifact(artifactDir);
    const entry = parseDraftYamlSnippet(artifacts.draftYaml);
    const storyName = await saveDraftToLibrary(
      artifactDir,
      meta.siteSlug,
      entry.id,
    );

    const runs = await listRuns();
    const summaries = await listStories(buildLastRunMap(runs));
    broadcast("stories:changed", summaries);

    return { ok: true as const, storyName };
  });

  ipcMain.handle("drafts:discard", async (_event, params: unknown) => {
    if (typeof params !== "object" || params === null || typeof (params as Record<string, unknown>)["draftId"] !== "string") {
      throw new Error("drafts:discard requires { draftId: string }");
    }
    const { draftId } = params as { draftId: string };
    await discardDraftDir(path.join(getDraftsDir(), draftId));
    return { ok: true as const };
  });
}

export function registerMigrationHandlers(): void {
  ipcMain.handle("stories:migrateLegacy", async () => {
    const { migrateLegacyStories } = await import("../services/stories-service.js");
    const result = await migrateLegacyStories();
    const runs = await listRuns();
    const summaries = await listStories(buildLastRunMap(runs));
    broadcast("stories:changed", summaries);
    return result;
  });
}
