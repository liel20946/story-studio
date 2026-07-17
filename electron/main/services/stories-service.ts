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
  siteSlugFromUrl,
  slugify,
  loadSiteFile,
  saveSiteFile,
  watchBowserFiles,
  findStoryById,
  resolveCreatedAt,
  normalizeBowserEntryForStorage,
  resolveStoryParts,
  formatAssertionsBlock,
  normalizeAssertionText,
  isBlankAssertion,
  validateBowserEntry,
  type BowserStoryEntry,
  type BowserSiteFile,
} from "./bowser-stories-service.js";
import { parse as parseYaml } from "yaml";

export type ImportMode = "overwrite" | "add";

export interface ImportPreviewFile {
  path: string;
  siteSlug: string;
  storyCount: number;
}

export interface ImportPreview {
  storyCount: number;
  fileCount: number;
  files: ImportPreviewFile[];
  errors: string[];
  valid: boolean;
}

export interface ExportPreview {
  storyCount: number;
  fileCount: number;
}

async function parseImportSiteFile(srcPath: string): Promise<BowserSiteFile> {
  const raw = await fs.readFile(srcPath, "utf-8");
  const file = parseYaml(raw) as BowserSiteFile | null;
  if (!file || !Array.isArray(file.stories)) {
    throw new Error("missing stories array");
  }
  return file;
}

function siteSlugFromImportPath(srcPath: string): string {
  return path.basename(srcPath).replace(/\.(yaml|yml)$/, "");
}

function summariesFromSite(
  siteSlug: string,
  stories: BowserStoryEntry[],
  lastRunMap: Map<string, { status: import("./contract-types.js").RunStatus; finishedAt: number }>,
): StorySummary[] {
  return stories.map((story) => {
    const name = compositeStoryName(siteSlug, story.id);
    return {
      name,
      title: story.name,
      baseUrl: story.url,
      createdAt: resolveCreatedAt(story.created_at, Date.now()),
      lastRun: lastRunMap.get(name) ?? null,
      siteSlug,
      storyId: story.id,
      mode: story.mode ?? "recorded",
    };
  });
}

export async function previewImportStories(filePaths: string[]): Promise<ImportPreview> {
  const errors: string[] = [];
  const files: ImportPreviewFile[] = [];
  let storyCount = 0;

  for (const srcPath of filePaths) {
    const basename = path.basename(srcPath);
    if (!srcPath.endsWith(".yaml") && !srcPath.endsWith(".yml")) {
      errors.push(`${basename}: not a YAML file`);
      continue;
    }

    try {
      const file = await parseImportSiteFile(srcPath);
      if (file.stories.length === 0) {
        errors.push(`${basename}: no stories found`);
        continue;
      }

      const siteSlug = siteSlugFromImportPath(srcPath);
      let validInFile = 0;
      for (const story of file.stories) {
        const entryErrors = validateBowserEntry(story);
        if (entryErrors.length > 0) {
          const label = story.id?.trim() || story.name?.trim() || "story";
          errors.push(`${basename} / ${label}: ${entryErrors.join("; ")}`);
          continue;
        }
        validInFile += 1;
      }

      if (validInFile === 0) {
        errors.push(`${basename}: no valid stories found`);
        continue;
      }

      storyCount += validInFile;
      files.push({ path: srcPath, siteSlug, storyCount: validInFile });
    } catch (err) {
      errors.push(`${basename}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    storyCount,
    fileCount: files.length,
    files,
    errors,
    valid: errors.length === 0 && storyCount > 0,
  };
}

export async function getExportPreview(): Promise<ExportPreview> {
  const lastRunMap = new Map<
    string,
    { status: import("./contract-types.js").RunStatus; finishedAt: number }
  >();
  const stories = await listStories(lastRunMap);
  const storiesDir = getStoriesDir();
  let fileCount = 0;
  try {
    const entries = await fs.readdir(storiesDir);
    fileCount = entries.filter((entry) => entry.endsWith(".yaml")).length;
  } catch {
    fileCount = 0;
  }
  return { storyCount: stories.length, fileCount };
}

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

export async function createManualStory(
  title: string,
  url: string,
): Promise<StoryDetail> {
  const storyTitle = title.trim();
  const startUrl = url.trim();
  if (!storyTitle) throw new Error("Story name is required");
  if (!startUrl) throw new Error("Start URL is required");

  try {
    new URL(startUrl);
  } catch {
    throw new Error("Start URL must be a valid URL");
  }

  const siteSlug = siteSlugFromUrl(startUrl);
  const file = await loadSiteFile(siteSlug);
  const baseId = slugify(storyTitle);
  let storyId = baseId;
  let suffix = 2;
  while (file.stories.some((story) => story.id === storyId)) {
    storyId = `${baseId}-${suffix}`;
    suffix += 1;
  }

  await appendStoryToSite(siteSlug, {
    id: storyId,
    name: storyTitle,
    url: startUrl,
    mode: "manual",
    workflow: "Navigate to the start URL\nDescribe the next action",
    assertions: "@2 Verify the expected result",
    variables: {},
    created_at: Date.now(),
  });

  return getBowserStory(compositeStoryName(siteSlug, storyId), new Map());
}

export async function deleteStory(name: string): Promise<void> {
  const parsed = parseCompositeName(name);
  if (!parsed) throw new Error(`Invalid story name: ${name}`);
  await deleteStoryFromSite(parsed.siteSlug, parsed.storyId);
  console.log("[stories] deleted", name);
}

async function importStoriesOverwrite(
  filePaths: string[],
  lastRunMap: Map<string, { status: import("./contract-types.js").RunStatus; finishedAt: number }>,
): Promise<StorySummary[]> {
  const results: StorySummary[] = [];
  for (const srcPath of filePaths) {
    if (!srcPath.endsWith(".yaml") && !srcPath.endsWith(".yml")) continue;

    const siteSlug = siteSlugFromImportPath(srcPath);
    const destPath = path.join(getStoriesDir(), `${siteSlug}.yaml`);
    await fs.copyFile(srcPath, destPath);
    const file = parseYaml(await fs.readFile(destPath, "utf-8")) as BowserSiteFile;
    results.push(...summariesFromSite(siteSlug, file.stories ?? [], lastRunMap));
  }
  return results;
}

async function importStoriesAdd(
  filePaths: string[],
  lastRunMap: Map<string, { status: import("./contract-types.js").RunStatus; finishedAt: number }>,
): Promise<StorySummary[]> {
  const results: StorySummary[] = [];
  for (const srcPath of filePaths) {
    if (!srcPath.endsWith(".yaml") && !srcPath.endsWith(".yml")) continue;

    const siteSlug = siteSlugFromImportPath(srcPath);
    const imported = await parseImportSiteFile(srcPath);
    const existing = await loadSiteFile(siteSlug);
    const existingIds = new Set(existing.stories.map((story) => story.id));
    const added: BowserStoryEntry[] = [];

    for (const story of imported.stories) {
      if (validateBowserEntry(story).length > 0) continue;
      if (existingIds.has(story.id)) continue;
      const normalized = normalizeBowserEntryForStorage({
        ...story,
        created_at: resolveCreatedAt(story.created_at, Date.now()),
      });
      existing.stories.push(normalized);
      existingIds.add(story.id);
      added.push(normalized);
    }

    if (added.length > 0) {
      await saveSiteFile(siteSlug, existing);
      results.push(...summariesFromSite(siteSlug, added, lastRunMap));
    }
  }
  return results;
}

export async function importStories(
  filePaths: string[],
  lastRunMap: Map<string, { status: import("./contract-types.js").RunStatus; finishedAt: number }>,
  mode: ImportMode = "overwrite",
): Promise<StorySummary[]> {
  if (mode === "add") {
    return importStoriesAdd(filePaths, lastRunMap);
  }
  return importStoriesOverwrite(filePaths, lastRunMap);
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
    globalRules: string;
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

  const globalRules = content.globalRules.trim();
  const { global_rules: _existingRules, ...existingWithoutRules } = existing;
  const entry = normalizeBowserEntryForStorage({
    ...existingWithoutRules,
    workflow: steps.join("\n"),
    assertions: formatAssertionsBlock(assertions),
    variables,
    ...(globalRules ? { global_rules: globalRules } : {}),
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
