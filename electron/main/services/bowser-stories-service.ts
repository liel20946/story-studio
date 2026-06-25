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

/** Normalize YAML `created_at` (number or numeric string) with a stable fallback. */
export function resolveCreatedAt(raw: unknown, fallbackMs: number): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw;
  if (typeof raw === "string") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return fallbackMs;
}

async function fileTimestampMs(filePath: string): Promise<number> {
  const stat = await fs.stat(filePath);
  return stat.birthtimeMs > 0 ? stat.birthtimeMs : stat.mtimeMs;
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

const CORRECTION_KEY_BASES = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "Backspace",
  "Delete",
]);

function isCorrectionPress(step: string): boolean {
  const match = step.match(/^Press "([^"]+)" on /);
  if (!match) return false;
  const baseKey = match[1].split("+").pop() ?? "";
  return CORRECTION_KEY_BASES.has(baseKey);
}

function fillOrTypeTarget(step: string): string | null {
  const fillMatch = step.match(/^Fill (.+?) with /);
  if (fillMatch) return fillMatch[1].trim();
  const typeMatch = step.match(/^Type ".+" into (.+)$/);
  if (typeMatch) return typeMatch[1].trim();
  return null;
}

/** Remove typo-correction noise and keep the final value per field. */
export function cleanRecordedSteps(steps: string[]): string[] {
  const result: string[] = [];
  const lastFillIndex = new Map<string, number>();
  let previous: string | null = null;

  for (const step of steps) {
    if (isCorrectionPress(step)) continue;
    if (previous !== null && step === previous && step.startsWith("Click ")) continue;

    const target = fillOrTypeTarget(step);
    if (target) {
      const existing = lastFillIndex.get(target);
      if (existing !== undefined) {
        result.splice(existing, 1);
        lastFillIndex.clear();
        for (let i = 0; i < result.length; i++) {
          const fillTarget = fillOrTypeTarget(result[i]);
          if (fillTarget) lastFillIndex.set(fillTarget, i);
        }
      }
      lastFillIndex.set(target, result.length);
    }

    result.push(step);
    previous = step;
  }

  return result;
}

/** Add fallback Verify steps when a recorded workflow has actions but no assertions. */
export function ensureVerifyStepsInWorkflow(lines: string[], baseUrl: string): string[] {
  if (lines.some((l) => /^verify\b/i.test(l))) return lines;

  const result = [...lines];
  const firstNav = result.findIndex((l) => l.startsWith("Navigate to "));
  if (firstNav >= 0) {
    result.splice(firstNav + 1, 0, "Verify the page loads successfully");
  } else if (baseUrl) {
    result.unshift(`Navigate to ${baseUrl}`, "Verify the page loads successfully");
  } else {
    result.unshift("Verify the page loads successfully");
  }

  let lastUrl = baseUrl;
  for (const line of result) {
    if (line.startsWith("Navigate to ")) {
      lastUrl = line.slice("Navigate to ".length).trim();
    }
  }

  try {
    const pathname = new URL(lastUrl).pathname;
    if (pathname && pathname !== "/") {
      result.push(`Verify the current URL contains "${pathname}"`);
    } else {
      result.push("Verify the expected page state is visible");
    }
  } catch {
    result.push("Verify the expected page state is visible");
  }

  return result;
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

function inferVariableKeyFromTarget(target: string, _value: string): string {
  const lowered = target.toLowerCase();
  if (lowered.includes("password")) return "login_password";
  if (lowered.includes("email") || lowered.includes("e-mail")) return "login_email";
  if (lowered.includes("username") || lowered.includes("user name")) return "login_username";
  if (lowered.includes("phone") || lowered.includes("mobile")) return "phone";
  if (lowered.includes("search")) return "search_query";
  const labelMatch = target.match(/"([^"]+)"/);
  if (labelMatch) {
    const key = slugify(labelMatch[1]).replace(/-/g, "_");
    if (key) return key;
  }
  return slugify(target).replace(/-/g, "_") || "input_value";
}

/** Infer variables from Fill/Type workflow lines when YAML has no variables block. */
export function inferVariablesFromWorkflow(workflow: string): Record<string, string> {
  const variables: Record<string, string> = {};
  const lines = cleanRecordedSteps(parseWorkflowLines(workflow));
  for (const line of lines) {
    const fillPlaceholder = line.match(/^Fill .+ with "\{\{(\w+)\}\}"$/i);
    if (fillPlaceholder) continue;

    const fillLiteral = line.match(/^Fill (.+?) with "([^"]+)"$/i);
    if (fillLiteral) {
      const [, target, value] = fillLiteral;
      let key = inferVariableKeyFromTarget(target, value);
      const baseKey = key;
      let n = 2;
      while (variables[key] !== undefined && variables[key] !== value) {
        key = `${baseKey}_${n}`;
        n++;
      }
      variables[key] = value;
      continue;
    }

    const typeLiteral = line.match(/^Type "([^"]+)" into (.+)$/i);
    if (typeLiteral) {
      const [, value, target] = typeLiteral;
      let key = inferVariableKeyFromTarget(target, value);
      const baseKey = key;
      let n = 2;
      while (variables[key] !== undefined && variables[key] !== value) {
        key = `${baseKey}_${n}`;
        n++;
      }
      variables[key] = value;
    }
  }
  return variables;
}

/** Collect {{variable}} names referenced in workflow lines. */
function collectPlaceholderVariables(workflowLines: string[]): Record<string, string> {
  const variables: Record<string, string> = {};
  const placeholderRe = /\{\{(\w+)\}\}/g;
  for (const line of workflowLines) {
    for (const match of line.matchAll(placeholderRe)) {
      const key = match[1];
      if (key && variables[key] === undefined) {
        variables[key] = "";
      }
    }
  }
  return variables;
}

function parseVariablesFromEntry(
  entry: BowserStoryEntry,
  workflowLines: string[],
): StoryVariable[] {
  const explicit = entry.variables ?? {};
  const inferred =
    Object.keys(explicit).length > 0
      ? explicit
      : inferVariablesFromWorkflow(workflowLines.join("\n"));
  const merged = { ...inferred, ...collectPlaceholderVariables(workflowLines) };
  return Object.entries(merged).map(([key, value]) => ({
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
  fileCreatedAt?: number,
): StoryDetail {
  const name = compositeStoryName(siteSlug, entry.id);
  const workflowLines = ensureVerifyStepsInWorkflow(
    cleanRecordedSteps(parseWorkflowLines(entry.workflow)),
    entry.url,
  );
  const { steps, assertions } = splitWorkflowSteps(workflowLines);
  return {
    name,
    title: entry.name,
    baseUrl: entry.url,
    createdAt: resolveCreatedAt(entry.created_at, fileCreatedAt ?? Date.now()),
    lastRun: lastRun ?? null,
    filePath,
    siteSlug,
    storyId: entry.id,
    tags: entry.tags ?? [],
    mode: entry.mode ?? "recorded",
    variables: parseVariablesFromEntry(entry, workflowLines),
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
  const toAppend: BowserStoryEntry = {
    ...entry,
    created_at: resolveCreatedAt(entry.created_at, Date.now()),
  };
  file.stories.push(toAppend);
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
      const fileCreatedAt = await fileTimestampMs(filePath);
      const file = parseYaml(raw) as BowserSiteFile;
      if (!file?.stories) continue;
      for (const story of file.stories) {
        const name = compositeStoryName(siteSlug, story.id);
        results.push({
          name,
          title: story.name,
          baseUrl: story.url,
          createdAt: resolveCreatedAt(story.created_at, fileCreatedAt),
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
  const fileCreatedAt = await fileTimestampMs(filePath);
  const raw = await fs.readFile(filePath, "utf-8");
  const file = parseYaml(raw) as BowserSiteFile;
  const entry = file.stories.find((s) => s.id === storyId);
  if (!entry) {
    throw new Error(`Story not found: ${name}`);
  }
  return entryToDetail(
    entry,
    siteSlug,
    filePath,
    raw,
    lastRunMap.get(name) ?? null,
    fileCreatedAt,
  );
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
    created_at: meta["created_at"]
      ? resolveCreatedAt(meta["created_at"], Date.now())
      : Date.now(),
  };
  if (variables.length > 0) {
    entry.variables = Object.fromEntries(variables.map((v) => [v.key, v.value]));
  }
  return { siteSlug, entry };
}

/** Format a story for agent run prompts (inline markdown). */
export function formatStoryForRun(story: StoryDetail): string {
  const rawLines =
    story.workflow.length > 0 ? story.workflow : [...story.steps, ...story.assertions];
  const lines = ensureVerifyStepsInWorkflow(rawLines, story.baseUrl ?? "");
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
