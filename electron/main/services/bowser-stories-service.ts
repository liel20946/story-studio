import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { StoryDetail, StorySummary, StoryVariable } from "./contract-types.js";
import { getStoriesDir } from "./paths.js";

// ---------- Bowser YAML v2 types ----------

export type BowserStoryMode = "recorded" | "generated";

export interface BowserAssertion {
  /** Number of workflow action steps completed before this assertion runs. */
  after: number;
  text: string;
}

export interface BowserStoryEntry {
  id: string;
  name: string;
  url: string;
  mode?: BowserStoryMode;
  workflow: string;
  /** Multiline block — one assertion per line, optionally prefixed with @N (step index). */
  assertions?: string;
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

/** Drop legacy `tags` fields when reading or writing Bowser entries. */
export function stripBowserEntryTags(entry: BowserStoryEntry & { tags?: unknown }): BowserStoryEntry {
  const { tags: _tags, ...rest } = entry;
  return rest;
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

export function normalizeAssertionText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed || /^verify\s*$/i.test(trimmed)) return "";
  if (/^verify\b/i.test(trimmed)) return trimmed;
  return `Verify ${trimmed}`;
}

export function isBlankAssertion(text: string): boolean {
  return normalizeAssertionText(text).length === 0;
}

/** Split interleaved legacy workflows into action steps and positioned assertions. */
export function splitWorkflowWithAssertions(workflowLines: string[]): {
  steps: string[];
  assertions: BowserAssertion[];
} {
  const steps: string[] = [];
  const assertions: BowserAssertion[] = [];
  for (const line of workflowLines) {
    if (/^verify\b/i.test(line)) {
      assertions.push({ after: steps.length, text: line });
    } else {
      steps.push(line);
    }
  }
  return { steps, assertions };
}

/** @deprecated Use splitWorkflowWithAssertions — kept for callers expecting string assertions. */
export function splitWorkflowSteps(workflowLines: string[]): {
  steps: string[];
  assertions: string[];
} {
  const { steps, assertions } = splitWorkflowWithAssertions(workflowLines);
  return { steps, assertions: assertions.map((a) => a.text) };
}

export function parseAssertionsBlock(assertions: string): BowserAssertion[] {
  return parseWorkflowLines(assertions).map((line) => {
    const positioned = line.match(/^@(\d+)\s+(.+)$/);
    if (positioned) {
      return {
        after: parseInt(positioned[1], 10),
        text: normalizeAssertionText(positioned[2]),
      };
    }
    return { after: -1, text: normalizeAssertionText(line) };
  });
}

export function formatAssertionsBlock(assertions: BowserAssertion[]): string {
  return assertions.map((a) => `@${a.after} ${a.text}`).join("\n");
}

/** Click/Navigate steps that only open another page, panel, or row — common end-of-recording tail. */
export function isEndStateNavigationStep(step: string): boolean {
  return /^(Click|Navigate to)\b/i.test(step.trim());
}

/** True when every step from fromIndex onward is end-state navigation only. */
export function hasOnlyEndStateNavigationTail(steps: string[], fromIndex: number): boolean {
  const tail = steps.slice(fromIndex);
  return tail.length > 0 && tail.every(isEndStateNavigationStep);
}

/**
 * Move the latest assertion(s) past trailing navigation clicks captured after the
 * main action — e.g. opening a detail row so the hero screenshot is the detail page.
 */
export function alignAssertionsWithEndStateNavigation(
  steps: string[],
  assertions: BowserAssertion[],
): BowserAssertion[] {
  if (steps.length === 0 || assertions.length === 0) return assertions;

  const maxAfter = Math.max(...assertions.map((a) => a.after));
  if (maxAfter >= steps.length) return assertions;
  if (!hasOnlyEndStateNavigationTail(steps, maxAfter)) return assertions;

  const endAfter = steps.length;
  return assertions.map((a) => (a.after === maxAfter ? { ...a, after: endAfter } : a));
}

/** Clamp @N positions into 0..stepCount — fixes common off-by-one from AI conversion. */
export function clampAssertionPositions(
  assertions: BowserAssertion[],
  stepCount: number,
): BowserAssertion[] {
  return assertions.map((a) => {
    if (a.after < 0) return { ...a, after: 0 };
    if (a.after > stepCount) {
      console.warn(
        `[bowser] clamping assertion "${a.text}" from @${a.after} to @${stepCount} (${stepCount} workflow steps)`,
      );
      return { ...a, after: stepCount };
    }
    return a;
  });
}

/** Add fallback assertions when a recorded workflow has actions but none defined. */
export function ensureFallbackAssertions(
  steps: string[],
  baseUrl: string,
): BowserAssertion[] {
  const assertions: BowserAssertion[] = [];
  const firstNav = steps.findIndex((l) => l.startsWith("Navigate to "));
  if (firstNav >= 0) {
    assertions.push({ after: firstNav + 1, text: "Verify the page loads successfully" });
  } else {
    assertions.push({ after: 0, text: "Verify the page loads successfully" });
  }

  let lastUrl = baseUrl;
  for (const line of steps) {
    if (line.startsWith("Navigate to ")) {
      lastUrl = line.slice("Navigate to ".length).trim();
    }
  }

  try {
    const pathname = new URL(lastUrl).pathname;
    if (pathname && pathname !== "/") {
      assertions.push({
        after: steps.length,
        text: `Verify the current URL contains "${pathname}"`,
      });
    } else {
      assertions.push({
        after: steps.length,
        text: "Verify the expected page state is visible",
      });
    }
  } catch {
    assertions.push({
      after: steps.length,
      text: "Verify the expected page state is visible",
    });
  }

  return assertions;
}

/** Reconstruct execution order from separate workflow steps and positioned assertions. */
export function mergeWorkflowForExecution(
  steps: string[],
  assertions: BowserAssertion[],
): string[] {
  const byAfter = new Map<number, string[]>();
  for (const assertion of assertions) {
    const bucket = byAfter.get(assertion.after) ?? [];
    bucket.push(assertion.text);
    byAfter.set(assertion.after, bucket);
  }

  const result: string[] = [];
  for (let i = 0; i <= steps.length; i++) {
    const pending = byAfter.get(i);
    if (pending) result.push(...pending);
    if (i < steps.length) result.push(steps[i]);
  }
  return result;
}

/** Resolve action steps and assertions from a Bowser entry (new or legacy format). */
export function resolveStoryParts(entry: BowserStoryEntry): {
  steps: string[];
  assertions: BowserAssertion[];
} {
  const rawWorkflow = cleanRecordedSteps(parseWorkflowLines(entry.workflow));
  const hasAssertionsField =
    entry.assertions !== undefined &&
    entry.assertions !== null &&
    String(entry.assertions).trim().length > 0;

  if (hasAssertionsField) {
    const { steps } = splitWorkflowWithAssertions(rawWorkflow);
    let assertions = parseAssertionsBlock(String(entry.assertions));
    assertions = assertions.map((a) =>
      a.after >= 0 ? a : { ...a, after: steps.length },
    );
    return { steps, assertions };
  }

  const { steps, assertions } = splitWorkflowWithAssertions(rawWorkflow);
  if (assertions.length === 0) {
    return { steps, assertions: ensureFallbackAssertions(steps, entry.url) };
  }
  return { steps, assertions };
}

/** Normalize an entry for YAML storage: workflow = actions only, assertions = separate block. */
export function normalizeBowserEntryForStorage(entry: BowserStoryEntry): BowserStoryEntry {
  const { steps, assertions } = resolveStoryParts(entry);
  let finalAssertions =
    assertions.length > 0 ? assertions : ensureFallbackAssertions(steps, entry.url);
  finalAssertions = alignAssertionsWithEndStateNavigation(steps, finalAssertions);
  finalAssertions = clampAssertionPositions(finalAssertions, steps.length);
  const { tags: _tags, ...rest } = stripBowserEntryTags(entry);
  return {
    ...rest,
    workflow: steps.join("\n"),
    assertions: formatAssertionsBlock(finalAssertions),
  };
}

/** @deprecated Use resolveStoryParts + mergeWorkflowForExecution. */
export function ensureVerifyStepsInWorkflow(lines: string[], baseUrl: string): string[] {
  const { steps, assertions } = splitWorkflowWithAssertions(lines);
  const resolved =
    assertions.length > 0 ? assertions : ensureFallbackAssertions(steps, baseUrl);
  return mergeWorkflowForExecution(steps, resolved);
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
  // Placeholders fill in missing keys only — explicit/inferred values must win.
  const merged = { ...collectPlaceholderVariables(workflowLines), ...inferred };
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
  const normalized = stripBowserEntryTags(entry);
  const name = compositeStoryName(siteSlug, normalized.id);
  const { steps, assertions } = resolveStoryParts(normalized);
  const workflowLines = mergeWorkflowForExecution(steps, assertions);
  return {
    name,
    title: normalized.name,
    baseUrl: normalized.url,
    createdAt: resolveCreatedAt(normalized.created_at, fileCreatedAt ?? Date.now()),
    lastRun: lastRun ?? null,
    filePath,
    siteSlug,
    storyId: normalized.id,
    mode: normalized.mode ?? "recorded",
    variables: parseVariablesFromEntry(normalized, steps),
    steps,
    assertions: assertions
      .map((a) => a.text)
      .filter((text) => !isBlankAssertion(text)),
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

  const { steps, assertions } = resolveStoryParts(entry);
  if (steps.some((l) => /^verify\b/i.test(l))) {
    errors.push("Workflow must contain action steps only — move Verify lines to assertions");
  }
  if (assertions.length === 0) {
    errors.push("Story must include at least one assertion");
  }
  for (const assertion of assertions) {
    if (assertion.after < 0 || assertion.after > steps.length) {
      errors.push(
        `Assertion "${assertion.text}" has invalid position @${assertion.after} (workflow has ${steps.length} steps)`,
      );
    }
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
  const normalized: BowserSiteFile = {
    stories: file.stories.map((story) => normalizeBowserEntryForStorage(story)),
  };
  const content = stringifyYaml(normalized, { lineWidth: 0 });
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
  const toAppend: BowserStoryEntry = normalizeBowserEntryForStorage({
    ...entry,
    created_at: resolveCreatedAt(entry.created_at, Date.now()),
  });
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
  file.stories[idx] = normalizeBowserEntryForStorage(entry);
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
  const { steps, assertions } = resolveStoryParts(entry);
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
    `## Assertions\n${assertions.map((a) => `- ${a.text}`).join("\n")}\n`
  );
}

/** Format a story for agent run prompts (inline markdown). */
export function formatStoryForRun(story: StoryDetail): string {
  const steps = story.steps.length > 0 ? story.steps : story.workflow.filter((l) => !/^verify\b/i.test(l));
  const assertionLines =
    story.assertions.length > 0
      ? story.assertions
      : story.workflow.filter((l) => /^verify\b/i.test(l));
  const execution = story.workflow.length > 0 ? story.workflow : [...steps, ...assertionLines];
  const lastStep = execution[execution.length - 1] ?? "";
  const lastIndex = execution.length;
  const vars =
    story.variables.length > 0
      ? `\n## Variables\n${story.variables.map((v) => `- ${v.key}: ${v.value}`).join("\n")}\n`
      : "";
  return (
    `# ${story.title}\n\n` +
    `URL: ${story.baseUrl ?? ""}\n` +
    `Mode: ${story.mode ?? "recorded"}\n` +
    vars +
    `\n## Steps\n${steps.map((l, i) => `${i + 1}. ${l}`).join("\n")}\n` +
    `\n## Assertions\n${assertionLines.map((l, i) => `${i + 1}. ${l}`).join("\n")}\n` +
    `\n## Execution order\n${execution.map((l, i) => `${i + 1}. ${l}`).join("\n")}\n` +
    (lastStep
      ? `\n## Hero screenshot\n` +
        `After execution step ${lastIndex} ("${lastStep}") passes, wait for the UI to fully reflect the outcome ` +
        `(e.g. new table row, success toast, or destination page), then capture a fresh hero screenshot. ` +
        `If the last action is a submit/click, do not screenshot until the resulting page state is visible.\n`
      : "")
  );
}

export async function findStoryById(
  storyId: string,
): Promise<{ siteSlug: string; entry: BowserStoryEntry } | null> {
  const slugs = await listSiteSlugs();
  for (const siteSlug of slugs) {
    const file = await loadSiteFile(siteSlug);
    const entry = file.stories.find((s) => s.id === storyId);
    if (entry) return { siteSlug, entry };
  }
  return null;
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
