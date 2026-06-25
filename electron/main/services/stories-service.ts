import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import { broadcast } from "../broadcast.js";
import type { StorySummary, StoryDetail, StoryVariable } from "./contract-types.js";
import { getStoriesDir, getDraftsDir } from "./paths.js";
import {
  listBowserSummaries,
  getBowserStory,
  appendStoryToSite,
  updateStoryInSite,
  deleteStoryFromSite,
  legacyMdToBowserEntry,
  compositeStoryName,
  parseCompositeName,
  watchBowserFiles,
  resolveCreatedAt,
  type BowserStoryEntry,
} from "./bowser-stories-service.js";
import { parse as parseYaml } from "yaml";
import type { BowserSiteFile } from "./bowser-stories-service.js";

// Re-export legacy parsers for migration
function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const lines = raw.split("\n");
  if (lines[0]?.trim() !== "---") return { meta: {}, body: raw };
  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) return { meta: {}, body: raw };
  const meta: Record<string, string> = {};
  for (let i = 1; i < endIdx; i++) {
    const m = lines[i]?.match(/^(\w+):\s*(.*)$/);
    if (m) meta[m[1]] = m[2]?.trim() ?? "";
  }
  return { meta, body: lines.slice(endIdx + 1).join("\n") };
}

function parseVariables(body: string): StoryVariable[] {
  const section = body.match(/## Variables\s*\n([\s\S]*?)(?=\n##|$)/i);
  if (!section) return [];
  return section[1]
    .split("\n")
    .map((l) => l.replace(/^[-*]\s*/, "").trim())
    .filter((l) => l.includes(":"))
    .map((l) => {
      const colonIdx = l.indexOf(":");
      const key = l.slice(0, colonIdx).trim().replace(/^`|`$/g, "");
      const value = l.slice(colonIdx + 1).trim().replace(/^`|`$/g, "");
      return { key, value, secret: /password|secret|token/i.test(key) };
    });
}

function parseSteps(body: string): string[] {
  const section = body.match(/## Steps\s*\n([\s\S]*?)(?=\n##|$)/i);
  if (!section) return [];
  return section[1]
    .split("\n")
    .map((l) => l.replace(/^\d+\.\s*|^[-*]\s*/, "").trim())
    .filter((l) => l.length > 0);
}

function parseAssertions(body: string): string[] {
  const section = body.match(/## Assertions\s*\n([\s\S]*?)(?=\n##|$)/i);
  if (!section) return [];
  return section[1]
    .split("\n")
    .map((l) => l.replace(/^[-*]\s*|\d+\.\s*/, "").trim())
    .filter((l) => l.length > 0);
}

export async function migrateLegacyStories(): Promise<{ migrated: number; errors: string[] }> {
  const storiesDir = getStoriesDir();
  let entries: string[];
  try {
    entries = await fs.readdir(storiesDir);
  } catch {
    return { migrated: 0, errors: [] };
  }

  let migrated = 0;
  const errors: string[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".story.md")) continue;
    const name = entry.replace(/\.story\.md$/, "");
    const filePath = path.join(storiesDir, entry);
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      const { siteSlug, entry: bowserEntry } = legacyMdToBowserEntry(
        name,
        raw,
        parseFrontmatter,
        parseSteps,
        parseAssertions,
        parseVariables,
      );
      await appendStoryToSite(siteSlug, bowserEntry);
      await fs.unlink(filePath);
      migrated++;
      console.log("[stories] migrated legacy", name, "->", compositeStoryName(siteSlug, bowserEntry.id));
    } catch (err) {
      errors.push(`${name}: ${String(err)}`);
    }
  }
  return { migrated, errors };
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
    if (srcPath.endsWith(".yaml")) {
      const basename = path.basename(srcPath);
      const siteSlug = basename.replace(/\.yaml$/, "");
      const destPath = path.join(getStoriesDir(), basename);
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
          tags: story.tags ?? [],
          mode: story.mode ?? "recorded",
        });
      }
    } else if (srcPath.endsWith(".story.md")) {
      const basename = path.basename(srcPath);
      const name = basename.replace(/\.story\.md$/, "");
      const raw = await fs.readFile(srcPath, "utf-8");
      const { siteSlug, entry } = legacyMdToBowserEntry(
        name,
        raw,
        parseFrontmatter,
        parseSteps,
        parseAssertions,
        parseVariables,
      );
      await appendStoryToSite(siteSlug, entry);
      const composite = compositeStoryName(siteSlug, entry.id);
      results.push({
        name: composite,
        title: entry.name,
        baseUrl: entry.url,
        createdAt: resolveCreatedAt(entry.created_at, Date.now()),
        lastRun: lastRunMap.get(composite) ?? null,
        siteSlug,
        storyId: entry.id,
        tags: entry.tags ?? [],
        mode: entry.mode ?? "recorded",
      });
    }
  }
  return results;
}

export async function updateStoryVariables(
  name: string,
  variables: { key: string; value: string }[],
  lastRun?: StorySummary["lastRun"],
): Promise<StoryDetail> {
  const parsed = parseCompositeName(name);
  if (!parsed) throw new Error(`Invalid story name: ${name}`);
  const detail = await getBowserStory(name, new Map());
  const entry: BowserStoryEntry = {
    id: detail.storyId!,
    name: detail.title,
    url: detail.baseUrl ?? "",
    tags: detail.tags,
    mode: detail.mode,
    workflow: detail.workflow.join("\n"),
    variables: Object.fromEntries(variables.map((v) => [v.key, v.value])),
    created_at: detail.createdAt,
  };
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
  const detail = await getBowserStory(name, new Map());
  const entry: BowserStoryEntry = {
    id: detail.storyId!,
    name: newTitle,
    url: detail.baseUrl ?? "",
    tags: detail.tags,
    mode: detail.mode,
    workflow: detail.workflow.join("\n"),
    variables: detail.variables.length
      ? Object.fromEntries(detail.variables.map((v) => [v.key, v.value]))
      : undefined,
    created_at: detail.createdAt,
  };
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
