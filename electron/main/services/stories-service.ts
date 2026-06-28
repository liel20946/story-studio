import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import { broadcast } from "../broadcast.js";
import type { StorySummary, StoryDetail } from "./contract-types.js";
import { getStoriesDir, getDraftsDir } from "./paths.js";
import {
  listBowserSummaries,
  getBowserStory,
  appendStoryToSite,
  updateStoryInSite,
  deleteStoryFromSite,
  compositeStoryName,
  parseCompositeName,
  loadSiteFile,
  watchBowserFiles,
  findStoryById,
  resolveCreatedAt,
  normalizeBowserEntryForStorage,
  resolveStoryParts,
  formatAssertionsBlock,
  normalizeAssertionText,
  isBlankAssertion,
  type BowserStoryEntry,
} from "./bowser-stories-service.js";
import { parse as parseYaml } from "yaml";
import type { BowserSiteFile } from "./bowser-stories-service.js";

export async function listStories(
  lastRunMap: Map<string, { status: import("./contract-types.js").RunStatus; finishedAt: number }>,
): Promise<StorySummary[]> {
  const results = await listBowserSummaries(lastRunMap);
  console.log("[stories] listed", results.length, "bowser stories");
  return results;
}

export async function getStory(
  name: string,
  lastRunMap: Map<string, { status: import("./contract-types.js").RunStatus; finishedAt: number }>,
): Promise<StoryDetail> {
  return getBowserStory(name, lastRunMap);
}

export async function deleteStory(name: string): Promise<void> {
  const parsed = parseCompositeName(name);
  if (!parsed) throw new Error(`Invalid story name: ${name}`);
  await deleteStoryFromSite(parsed.siteSlug, parsed.storyId);
  console.log("[stories] deleted", name);
}

export async function importStories(
  filePaths: string[],
  lastRunMap: Map<string, { status: import("./contract-types.js").RunStatus; finishedAt: number }>,
): Promise<StorySummary[]> {
  const results: StorySummary[] = [];
  for (const srcPath of filePaths) {
    if (!srcPath.endsWith(".yaml") && !srcPath.endsWith(".yml")) continue;

    const basename = path.basename(srcPath);
    const siteSlug = basename.replace(/\.(yaml|yml)$/, "");
    const destPath = path.join(getStoriesDir(), `${siteSlug}.yaml`);
    await fs.copyFile(srcPath, destPath);
    const file = parseYaml(await fs.readFile(destPath, "utf-8")) as BowserSiteFile;
    for (const story of file.stories ?? []) {
      const name = compositeStoryName(siteSlug, story.id);
      results.push({
        name,
        title: story.name,
        baseUrl: story.url,
        createdAt: resolveCreatedAt(story.created_at, Date.now()),
        lastRun: lastRunMap.get(name) ?? null,
        siteSlug,
        storyId: story.id,
        mode: story.mode ?? "recorded",
      });
    }
  }
  return results;
}

export async function exportStories(destDir: string): Promise<{ fileCount: number }> {
  const storiesDir = getStoriesDir();
  let entries: string[];
  try {
    entries = await fs.readdir(storiesDir);
  } catch {
    return { fileCount: 0 };
  }

  const yamlFiles = entries.filter((entry) => entry.endsWith(".yaml"));
  if (yamlFiles.length === 0) {
    return { fileCount: 0 };
  }

  await fs.mkdir(destDir, { recursive: true });
  for (const entry of yamlFiles) {
    await fs.copyFile(path.join(storiesDir, entry), path.join(destDir, entry));
  }
  return { fileCount: yamlFiles.length };
}

export async function updateStoryContent(
  name: string,
  content: {
    steps: string[];
    variables: { key: string; value: string }[];
    assertions: string[];
  },
  lastRun?: StorySummary["lastRun"],
): Promise<StoryDetail> {
  const parsed = parseCompositeName(name);
  if (!parsed) throw new Error(`Invalid story name: ${name}`);
  const file = await loadSiteFile(parsed.siteSlug);
  const existing = file.stories.find((s) => s.id === parsed.storyId);
  if (!existing) throw new Error(`Story not found: ${name}`);

  const steps = content.steps.map((s) => s.trim()).filter((s) => s.length > 0);
  const { assertions: originalAssertions } = resolveStoryParts(existing);

  const assertions = content.assertions
    .map((text, i) => {
      if (isBlankAssertion(text)) return null;
      return {
        after:
          i < originalAssertions.length ? originalAssertions[i].after : steps.length,
        text: normalizeAssertionText(text),
      };
    })
    .filter((a): a is { after: number; text: string } => a !== null);

  const variables = Object.fromEntries(
    content.variables
      .map((v) => [v.key.trim(), v.value] as const)
      .filter(([key]) => key.length > 0),
  );

  const entry = normalizeBowserEntryForStorage({
    ...existing,
    workflow: steps.join("\n"),
    assertions: formatAssertionsBlock(assertions),
    variables,
  });

  await updateStoryInSite(parsed.siteSlug, parsed.storyId, entry);
  return getBowserStory(name, lastRun ? new Map([[name, lastRun]]) : new Map());
}

export async function updateStoryVariables(
  name: string,
  variables: { key: string; value: string }[],
  lastRun?: StorySummary["lastRun"],
): Promise<StoryDetail> {
  const parsed = parseCompositeName(name);
  if (!parsed) throw new Error(`Invalid story name: ${name}`);
  const file = await loadSiteFile(parsed.siteSlug);
  const existing = file.stories.find((s) => s.id === parsed.storyId);
  if (!existing) throw new Error(`Story not found: ${name}`);
  const entry = normalizeBowserEntryForStorage({
    ...existing,
    variables: Object.fromEntries(variables.map((v) => [v.key, v.value])),
  });
  await updateStoryInSite(parsed.siteSlug, parsed.storyId, entry);
  return getBowserStory(name, lastRun ? new Map([[name, lastRun]]) : new Map());
}

export async function renameStory(
  name: string,
  newTitle: string,
  lastRun?: StorySummary["lastRun"],
): Promise<StoryDetail> {
  const parsed = parseCompositeName(name);
  if (!parsed) throw new Error(`Invalid story name: ${name}`);
  const file = await loadSiteFile(parsed.siteSlug);
  const existing = file.stories.find((s) => s.id === parsed.storyId);
  if (!existing) throw new Error(`Story not found: ${name}`);
  const entry = normalizeBowserEntryForStorage({
    ...existing,
    name: newTitle,
  });
  await updateStoryInSite(parsed.siteSlug, parsed.storyId, entry);
  return getBowserStory(name, lastRun ? new Map([[name, lastRun]]) : new Map());
}

export async function appendApprovedStory(
  siteSlug: string,
  entry: BowserStoryEntry,
): Promise<string> {
  await appendStoryToSite(siteSlug, entry);
  return compositeStoryName(siteSlug, entry.id);
}

let watcher: fsSync.FSWatcher | null = null;

export function watchStories(
  lastRunMap: Map<string, { status: import("./contract-types.js").RunStatus; finishedAt: number }>,
): void {
  if (watcher) {
    try {
      watcher.close();
    } catch {
      // ignore
    }
  }
  watcher = watchBowserFiles(() => {
    listStories(lastRunMap).then((summaries) => {
      broadcast("stories:changed", summaries);
    });
  });
}

export function stopWatchingStories(): void {
  if (watcher) {
    try {
      watcher.close();
    } catch {
      // ignore
    }
    watcher = null;
  }
}

// Draft artifact helpers
export async function createDraftDir(siteSlug: string): Promise<string> {
  const draftId = `${siteSlug}-${Date.now()}`;
  const dir = path.join(getDraftsDir(), draftId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function readDraftArtifact(draftDir: string): Promise<{
  draftMd: string;
  draftYaml: string;
  recordingSpec?: string;
}> {
  const draftMd = await fs.readFile(path.join(draftDir, "draft.story.md"), "utf-8");
  const draftYaml = await fs.readFile(path.join(draftDir, "draft.story.yaml"), "utf-8");
  let recordingSpec: string | undefined;
  try {
    recordingSpec = await fs.readFile(path.join(draftDir, "recording.spec.ts"), "utf-8");
  } catch {
    // optional
  }
  return { draftMd, draftYaml, recordingSpec };
}

export async function discardDraftDir(draftDir: string): Promise<void> {
  await fs.rm(draftDir, { recursive: true, force: true });
}

export function parseDraftYamlSnippet(yamlSnippet: string): BowserStoryEntry {
  const parsed = parseYaml(yamlSnippet) as { stories?: BowserStoryEntry[] } | BowserStoryEntry;
  if (parsed && "stories" in parsed && Array.isArray(parsed.stories) && parsed.stories[0]) {
    return parsed.stories[0];
  }
  if (parsed && "id" in parsed) {
    return parsed as BowserStoryEntry;
  }
  throw new Error("Invalid draft YAML snippet");
}

/** Persist draft artifacts into the story library (new story or overwrite). */
export async function saveDraftToLibrary(
  draftDir: string,
  siteSlug: string,
  overwriteStoryId?: string,
): Promise<string> {
  const draftYaml = await fs.readFile(path.join(draftDir, "draft.story.yaml"), "utf-8");
  const entry = parseDraftYamlSnippet(draftYaml);

  const lookupId = overwriteStoryId ?? entry.id;
  const located = await findStoryById(lookupId);
  const targetSiteSlug = located?.siteSlug ?? siteSlug;
  const existing =
    located?.entry ?? (await loadSiteFile(targetSiteSlug)).stories.find((s) => s.id === entry.id);

  if (existing) {
    await updateStoryInSite(targetSiteSlug, entry.id, {
      ...entry,
      created_at: existing.created_at ?? entry.created_at,
    });
  } else {
    await appendStoryToSite(targetSiteSlug, entry);
  }
  const storyName = compositeStoryName(targetSiteSlug, entry.id);
  await discardDraftDir(draftDir);
  return storyName;
}
