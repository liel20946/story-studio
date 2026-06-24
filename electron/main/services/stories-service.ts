import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import { broadcast } from "../broadcast.js";
import type { StorySummary, StoryDetail, StoryVariable } from "./contract-types.js";
import { getStoriesDir } from "./paths.js";

// ---------- Frontmatter parser ----------
// Minimal YAML frontmatter: reads key: value lines between --- fences.
function parseFrontmatter(raw: string): {
  meta: Record<string, string>;
  body: string;
} {
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

function parseTitle(meta: Record<string, string>, body: string, name: string): string {
  if (meta["title"]) return meta["title"];
  const m = body.match(/^#\s+(.+)$/m);
  if (m) return m[1].trim();
  return name;
}

function parseVariables(body: string): StoryVariable[] {
  // Look for a "## Variables" section with lines like: - key: value
  const section = body.match(/## Variables\s*\n([\s\S]*?)(?=\n##|$)/i);
  if (!section) return [];
  return section[1]
    .split("\n")
    .map((l) => l.replace(/^[-*]\s*/, "").trim())
    .filter((l) => l.includes(":"))
    .map((l) => {
      const colonIdx = l.indexOf(":");
      const key = l.slice(0, colonIdx).trim();
      const value = l.slice(colonIdx + 1).trim();
      return {
        key,
        value,
        secret: /password|secret|token/i.test(key),
      };
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

// ---------- Story loading ----------
async function loadStoryDetail(
  filePath: string,
  name: string,
  lastRun?: StorySummary["lastRun"],
): Promise<StoryDetail> {
  const raw = await fs.readFile(filePath, "utf-8");
  const { meta, body } = parseFrontmatter(raw);
  const title = parseTitle(meta, body, name);
  return {
    name,
    title,
    baseUrl: meta["base_url"] ?? undefined,
    lastRun: lastRun ?? null,
    filePath,
    variables: parseVariables(body),
    steps: parseSteps(body),
    assertions: parseAssertions(body),
    raw,
  };
}

export async function listStories(
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
    if (!entry.endsWith(".story.md")) continue;
    const name = entry.replace(/\.story\.md$/, "");
    const filePath = path.join(storiesDir, entry);
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      const { meta, body } = parseFrontmatter(raw);
      const title = parseTitle(meta, body, name);
      results.push({
        name,
        title,
        baseUrl: meta["base_url"] ?? undefined,
        lastRun: lastRunMap.get(name) ?? null,
      });
    } catch {
      // skip unreadable files
    }
  }
  console.log("[stories] listed", results.length, "stories");
  return results;
}

export async function getStory(
  name: string,
  lastRunMap: Map<string, { status: import("./contract-types.js").RunStatus; finishedAt: number }>,
): Promise<StoryDetail> {
  const storiesDir = getStoriesDir();
  const filePath = path.join(storiesDir, `${name}.story.md`);
  try {
    await fs.access(filePath);
  } catch {
    throw new Error(`Story not found: ${name} (expected ${filePath})`);
  }
  return loadStoryDetail(filePath, name, lastRunMap.get(name) ?? null);
}

export async function deleteStory(name: string): Promise<void> {
  const storiesDir = getStoriesDir();
  const filePath = path.join(storiesDir, `${name}.story.md`);
  try {
    await fs.unlink(filePath);
    console.log("[stories] deleted", name);
  } catch (err) {
    throw new Error(`Failed to delete story "${name}": ${String(err)}`);
  }
}

export async function importStories(
  filePaths: string[],
  lastRunMap: Map<string, { status: import("./contract-types.js").RunStatus; finishedAt: number }>,
): Promise<StorySummary[]> {
  const storiesDir = getStoriesDir();
  const results: StorySummary[] = [];
  for (const srcPath of filePaths) {
    if (!srcPath.endsWith(".story.md")) continue;
    const basename = path.basename(srcPath);
    const name = basename.replace(/\.story\.md$/, "");
    const destPath = path.join(storiesDir, basename);
    try {
      await fs.copyFile(srcPath, destPath);
      const raw = await fs.readFile(destPath, "utf-8");
      const { meta, body } = parseFrontmatter(raw);
      const title = parseTitle(meta, body, name);
      results.push({
        name,
        title,
        baseUrl: meta["base_url"] ?? undefined,
        lastRun: lastRunMap.get(name) ?? null,
      });
      console.log("[stories] imported", name, "from", srcPath);
    } catch (err) {
      console.error("[stories] import failed for", srcPath, err);
    }
  }
  return results;
}

// Update variable VALUES in a story file, preserving the file's existing
// formatting (bullet style + backtick wrapping). Keys are matched after
// stripping backticks; keys are never renamed (steps reference them).
export async function updateStoryVariables(
  name: string,
  variables: { key: string; value: string }[],
  lastRun?: StorySummary["lastRun"],
): Promise<StoryDetail> {
  const storiesDir = getStoriesDir();
  const filePath = path.join(storiesDir, `${name}.story.md`);
  const raw = await fs.readFile(filePath, "utf-8");
  const lines = raw.split("\n");
  const valueByKey = new Map(variables.map((v) => [v.key, v.value]));

  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+Variables\s*$/i.test(lines[i].trim())) {
      start = i;
      break;
    }
  }

  if (start !== -1) {
    for (let i = start + 1; i < lines.length; i++) {
      const line = lines[i];
      if (/^##\s+/.test(line.trim())) break; // next section
      if (!line.includes(":")) continue;
      const bulletMatch = line.match(/^(\s*[-*]\s*)?(.*)$/);
      const bulletPrefix = bulletMatch?.[1] ?? "- ";
      const afterBullet = bulletMatch?.[2] ?? line;
      const colonIdx = afterBullet.indexOf(":");
      if (colonIdx === -1) continue;
      const keyPart = afterBullet.slice(0, colonIdx); // preserve key formatting
      const strippedKey = keyPart.trim().replace(/^`|`$/g, "");
      if (!valueByKey.has(strippedKey)) continue;
      const oldValPart = afterBullet.slice(colonIdx + 1).trim();
      const wrapped = oldValPart.startsWith("`");
      const newVal = valueByKey.get(strippedKey) ?? "";
      const valStr = wrapped ? `\`${newVal}\`` : newVal;
      lines[i] = `${bulletPrefix}${keyPart}: ${valStr}`;
    }
  }

  await fs.writeFile(filePath, lines.join("\n"), "utf-8");
  console.log("[stories] updated variables for", name);
  return loadStoryDetail(filePath, name, lastRun ?? null);
}

// Rename a story's DISPLAY title by updating the `title:` frontmatter field.
// The file name / `name` id is deliberately left untouched so existing run
// history and sidebar section assignments (both keyed by `name`) keep working.
export async function renameStory(
  name: string,
  newTitle: string,
  lastRun?: StorySummary["lastRun"],
): Promise<StoryDetail> {
  const storiesDir = getStoriesDir();
  const filePath = path.join(storiesDir, `${name}.story.md`);
  const raw = await fs.readFile(filePath, "utf-8");
  const lines = raw.split("\n");
  const titleLine = `title: ${newTitle}`;

  if (lines[0]?.trim() === "---") {
    let end = -1;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === "---") {
        end = i;
        break;
      }
    }
    if (end !== -1) {
      let titleIdx = -1;
      for (let i = 1; i < end; i++) {
        if (/^title\s*:/.test(lines[i].trim())) {
          titleIdx = i;
          break;
        }
      }
      if (titleIdx !== -1) lines[titleIdx] = titleLine;
      else lines.splice(end, 0, titleLine);
    } else {
      lines.unshift("---", titleLine, "---");
    }
  } else {
    lines.unshift("---", titleLine, "---");
  }

  await fs.writeFile(filePath, lines.join("\n"), "utf-8");
  console.log("[stories] renamed", name, "->", newTitle);
  return loadStoryDetail(filePath, name, lastRun ?? null);
}

export async function writeStoryFile(name: string, content: string): Promise<string> {
  const storiesDir = getStoriesDir();
  const filePath = path.join(storiesDir, `${name}.story.md`);
  await fs.writeFile(filePath, content, "utf-8");
  console.log("[stories] wrote story file", filePath);
  return filePath;
}

// ---------- File watcher ----------
let watcher: fsSync.FSWatcher | null = null;

export function watchStories(
  lastRunMap: Map<string, { status: import("./contract-types.js").RunStatus; finishedAt: number }>,
): void {
  const storiesDir = getStoriesDir();
  if (!fsSync.existsSync(storiesDir)) {
    fsSync.mkdirSync(storiesDir, { recursive: true });
  }
  if (watcher) {
    try {
      watcher.close();
    } catch {
      // ignore
    }
  }
  watcher = fsSync.watch(storiesDir, { persistent: false }, (_event, filename) => {
    if (filename && !filename.endsWith(".story.md")) return;
    listStories(lastRunMap).then((summaries) => {
      broadcast("stories:changed", summaries);
      console.log("[stories] fs.watch triggered broadcast, count:", summaries.length);
    });
  });
  watcher.on("error", (err) => {
    console.warn("[stories] fs.watch error:", err);
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
