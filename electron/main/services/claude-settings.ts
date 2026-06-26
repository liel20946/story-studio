import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

async function readAvailableModels(filePath: string): Promise<string[]> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as { availableModels?: unknown };
    if (!Array.isArray(parsed.availableModels)) return [];
    return parsed.availableModels.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}

/** Merge availableModels from Claude Code user + project settings (same order as the CLI). */
export async function loadClaudeAvailableModels(projectDirs: string[]): Promise<string[]> {
  const paths = [
    path.join(os.homedir(), ".claude", "settings.json"),
    ...projectDirs.flatMap((dir) => [
      path.join(dir, ".claude", "settings.json"),
      path.join(dir, ".claude", "settings.local.json"),
    ]),
  ];

  const merged: string[] = [];
  const seen = new Set<string>();
  for (const filePath of paths) {
    for (const entry of await readAvailableModels(filePath)) {
      if (seen.has(entry)) continue;
      seen.add(entry);
      merged.push(entry);
    }
  }
  return merged;
}
