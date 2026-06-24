import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { StoryDetail, StorySummary, StoryVariable } from "./contract-types.js";
import { getStoriesDir } from "./paths.js";

// ---------- Bowser YAML v2 types ----------

export type BowserStoryMode = "recorded" | "generated";

export interface BowserStoryEntry {
  id: string;
  name: string;
  url: string;
  tags?: string[];
  mode?: BowserStoryMode;
  workflow: string;
  variables?: Record<string, string>;
  created_at?: number;
}

export interface BowserSiteFile {
  stories: BowserStoryEntry[];
}

// Composite name: site-slug--story-id (used in routes and run history)
export function compositeStoryName(siteSlug: string, storyId: string): string {
  return `${siteSlug}--${storyId}`;
}

export function parseCompositeName(name: string): { siteSlug: string; storyId: string } | null {
  const idx = name.indexOf("--");
  if (idx <= 0 || idx >= name.length - 2) return null;
  return {
    siteSlug: name.slice(0, idx),
    storyId: name.slice(idx + 2),
  };
}

export function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "site"
  );
}

export function siteSlugFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    return slugify(host.split(".").slice(0, -1).join("-") || host);
  } catch {
    return slugify(url);
  }
}

export function siteFilePath(siteSlug: string): string {
  return path.join(getStoriesDir(), `${siteSlug}.yaml`);
}

export function parseWorkflowLines(workflow: string): string[] {
  return workflow
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

export function splitWorkflowSteps(workflowLines: string[]): {
  steps: string[];
  assertions: string[];
} {
  const steps: string[] = [];
  const assertions: string[] = [];
  for (const line of workflowLines) {
    if (/^verify\b/i.test(line)) {
      assertions.push(line);
    } else {
      steps.push(line);
    }
  }
  return { steps, assertions };
}

function parseVariablesFromEntry(entry: BowserStoryEntry): StoryVariable[] {
  if (!entry.variables) return [];
  return Object.entries(entry.variables).map(([key, value]) => ({
    key,
    value,
    secret: /password|secret|token/i.test(key),
  }));
}

function entryToDetail(
  entry: BowserStoryEntry,
  siteSlug: string,
  filePath: string,
  rawYaml: string,
  lastRun?: StorySummary["lastRun"],
): StoryDetail {
  const name = compositeStoryName(siteSlug, entry.id);
  const workflowLines = parseWorkflowLines(entry.workflow);
  const { steps, assertions } = splitWorkflowSteps(workflowLines);
  return {
    name,
    title: entry.name,
    baseUrl: entry.url,
    createdAt: entry.created_at ?? Date.now(),
    lastRun: lastRun ?? null,
    filePath,
    siteSlug,
    storyId: entry.id,
    tags: entry.tags ?? [],
    mode: entry.mode ?? "recorded",
    variables: parseVariablesFromEntry(entry),
    steps,
    assertions,
    workflow: workflowLines,
    raw: rawYaml,
  };
}

export function validateBowserEntry(entry: BowserStoryEntry): string[] {
  const errors: string[] = [];
  if (!entry.id?.trim()) errors.push("Story id is required");
  if (!entry.name?.trim()) errors.push("Story name is required");
  if (!entry.url?.trim()) errors.push("Story url is required");
  if (!entry.workflow?.trim()) errors.push("Story workflow is required");
  const lines = parseWorkflowLines(entry.workflow);
  if (!lines.some((l) => /^verify\b/i.test(l))) {
    errors.push("Story must include at least one Verify step");
  }
  return errors;
}

export async function loadSiteFile(siteSlug: string): Promise<BowserSiteFile> {
  const filePath = siteFilePath(siteSlug);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = parseYaml(raw) as BowserSiteFile | null;
    if (!parsed || !Array.isArray(parsed.stories)) {
      return { stories: [] };
    }
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { stories: [] };
    }
    throw err;
  }
}

export async function saveSiteFile(siteSlug: string, file: BowserSiteFile): Promise<void> {
  const filePath = siteFilePath(siteSlug);
  const content = stringifyYaml(file, { lineWidth: 0 });
  await fs.writeFile(filePath, content, "utf-8");
}

export async function appendStoryToSite(
  siteSlug: string,
  entry: BowserStoryEntry,
): Promise<void> {
  const errors = validateBowserEntry(entry);
  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }
  const file = await loadSiteFile(siteSlug);
  if (file.stories.some((s) => s.id === entry.id)) {
    throw new Error(`Story id "${entry.id}" already exists in ${siteSlug}.yaml`);
  }
  file.stories.push(entry);
  await saveSiteFile(siteSlug, file);
}

export async function updateStoryInSite(
  siteSlug: string,
  storyId: string,
  entry: BowserStoryEntry,
): Promise<void> {
  const errors = validateBowserEntry(entry);
  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }
  const file = await loadSiteFile(siteSlug);
  const idx = file.stories.findIndex((s) => s.id === storyId);
  if (idx === -1) {
    throw new Error(`Story "${storyId}" not found in ${siteSlug}.yaml`);
  }
  if (entry.id !== storyId && file.stories.some((s) => s.id === entry.id)) {
    throw new Error(`Story id "${entry.id}" already exists`);
  }
  file.stories[idx] = entry;
  await saveSiteFile(siteSlug, file);
}

export async function deleteStoryFromSite(siteSlug: string, storyId: string): Promise<void> {
  const file = await loadSiteFile(siteSlug);
  const next = file.stories.filter((s) => s.id !== storyId);
  if (next.length === file.stories.length) {
    throw new Error(`Story "${storyId}" not found in ${siteSlug}.yaml`);
  }
  if (next.length === 0) {
    await fs.unlink(siteFilePath(siteSlug)).catch(() => {});
  } else {
    await saveSiteFile(siteSlug, { stories: next });
  }
}

export async function listBowserSummaries(
  lastRunMap: Map<string, { status: import("./contract-types.js").RunStatus; finishedAt: number }>,
): Promise<StorySummary[]> {
  const storiesDir = getStoriesDir();
  let entries: string[];
  try {
    entries = await fs.readdir(storiesDir);
  } catch {
    return [];
  }

  const results: StorySummary[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".yaml")) continue;
    const siteSlug = entry.replace(/\.yaml$/, "");
    const filePath = path.join(storiesDir, entry);
    let raw = "";
    try {
      raw = await fs.readFile(filePath, "utf-8");
      const file = parseYaml(raw) as BowserSiteFile;
      if (!file?.stories) continue;
      for (const story of file.stories) {
        const name = compositeStoryName(siteSlug, story.id);
        results.push({
          name,
          title: story.name,
          baseUrl: story.url,
          createdAt: story.created_at ?? Date.now(),
          lastRun: lastRunMap.get(name) ?? null,
          siteSlug,
          storyId: story.id,
          tags: story.tags ?? [],
          mode: story.mode ?? "recorded",
        });
      }
    } catch {
      // skip unreadable
    }
  }
  return results;
}

export async function getBowserStory(
  name: string,
  lastRunMap: Map<string, { status: import("./contract-types.js").RunStatus; finishedAt: number }>,
): Promise<StoryDetail> {
  const parsed = parseCompositeName(name);
  if (!parsed) {
    throw new Error(`Invalid story name format (expected site--id): ${name}`);
  }
  const { siteSlug, storyId } = parsed;
  const filePath = siteFilePath(siteSlug);
  const raw = await fs.readFile(filePath, "utf-8");
  const file = parseYaml(raw) as BowserSiteFile;
  const entry = file.stories.find((s) => s.id === storyId);
  if (!entry) {
    throw new Error(`Story not found: ${name}`);
  }
  return entryToDetail(entry, siteSlug, filePath, raw, lastRunMap.get(name) ?? null);
}

export function storyEntryToMarkdown(entry: BowserStoryEntry): string {
  const lines = parseWorkflowLines(entry.workflow);
  const { steps, assertions } = splitWorkflowSteps(lines);
  const vars = entry.variables
    ? Object.entries(entry.variables)
        .map(([k, v]) => `- \`${k}\`: ${v}`)
        .join("\n")
    : "";
  return (
    `---\nname: ${entry.id}\ntitle: ${entry.name}\nbase_url: ${entry.url}\nmode: ${entry.mode ?? "recorded"}\n---\n\n` +
    `# ${entry.name}\n\n` +
    (vars ? `## Variables\n${vars}\n\n` : "") +
    `## Steps\n${steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n\n` +
    `## Assertions\n${assertions.map((a) => `- ${a}`).join("\n")}\n`
  );
}

/** Convert legacy .story.md content to a BowserStoryEntry. */
export function legacyMdToBowserEntry(
  name: string,
  raw: string,
  parseFrontmatter: (raw: string) => { meta: Record<string, string>; body: string },
  parseSteps: (body: string) => string[],
  parseAssertions: (body: string) => string[],
  parseVariables: (body: string) => StoryVariable[],
): { siteSlug: string; entry: BowserStoryEntry } {
  const { meta, body } = parseFrontmatter(raw);
  const steps = parseSteps(body);
  const assertions = parseAssertions(body);
  const variables = parseVariables(body);
  const baseUrl = meta["base_url"] ?? "";
  const title = meta["title"] ?? name;
  const siteSlug = baseUrl ? siteSlugFromUrl(baseUrl) : slugify(name);
  const storyId = slugify(name);
  const workflowLines = [...steps, ...assertions.map((a) => (a.startsWith("Verify") ? a : `Verify ${a}`))];
  const entry: BowserStoryEntry = {
    id: storyId,
    name: title,
    url: baseUrl || "https://example.com",
    tags: ["migrated"],
    mode: "recorded",
    workflow: workflowLines.join("\n"),
    created_at: meta["created_at"] ? Number(meta["created_at"]) : Date.now(),
  };
  if (variables.length > 0) {
    entry.variables = Object.fromEntries(variables.map((v) => [v.key, v.value]));
  }
  return { siteSlug, entry };
}

/** Format a story for agent run prompts (inline markdown). */
export function formatStoryForRun(story: StoryDetail): string {
  const lines = story.workflow.length > 0 ? story.workflow : [...story.steps, ...story.assertions];
  const vars =
    story.variables.length > 0
      ? `\n## Variables\n${story.variables.map((v) => `- ${v.key}: ${v.value}`).join("\n")}\n`
      : "";
  return (
    `# ${story.title}\n\n` +
    `URL: ${story.baseUrl ?? ""}\n` +
    `Tags: ${(story.tags ?? []).join(", ")}\n` +
    `Mode: ${story.mode ?? "recorded"}\n` +
    vars +
    `\n## Workflow\n${lines.map((l, i) => `${i + 1}. ${l}`).join("\n")}\n`
  );
}

export async function listSiteSlugs(): Promise<string[]> {
  const storiesDir = getStoriesDir();
  try {
    const entries = await fs.readdir(storiesDir);
    return entries.filter((e) => e.endsWith(".yaml")).map((e) => e.replace(/\.yaml$/, ""));
  } catch {
    return [];
  }
}

export function watchBowserFiles(
  onChange: () => void,
): fsSync.FSWatcher | null {
  const storiesDir = getStoriesDir();
  if (!fsSync.existsSync(storiesDir)) {
    fsSync.mkdirSync(storiesDir, { recursive: true });
  }
  const watcher = fsSync.watch(storiesDir, { persistent: false }, (_event, filename) => {
    if (filename && !filename.endsWith(".yaml")) return;
    onChange();
  });
  watcher.on("error", (err) => {
    console.warn("[bowser] fs.watch error:", err);
  });
  return watcher;
}
