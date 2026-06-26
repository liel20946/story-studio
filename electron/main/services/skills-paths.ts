import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { app } from "../electron-api.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function findProjectRoot(): string | null {
  const starts = [process.cwd(), __dirname];

  for (const start of starts) {
    let dir = start;
    while (true) {
      const packageJsonPath = path.join(dir, "package.json");
      if (fs.existsSync(packageJsonPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as { name?: string };
          if (pkg.name === "story-studio") {
            return dir;
          }
        } catch {
          // keep walking
        }
      }

      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }

  return null;
}

function skillsScriptsCandidates(): string[] {
  const root = findProjectRoot();
  const candidates: string[] = [];

  // Prefer the live repo scripts during local development so skill edits apply
  // without rebuilding the branded Electron.app bundle.
  if (root) {
    candidates.push(path.join(root, "resources", "skills", "scripts"));
  }

  candidates.push(path.join(app.getAppPath(), "resources", "skills", "scripts"));

  if (app.isPackaged) {
    candidates.push(path.join(process.resourcesPath, "skills", "scripts"));
  }

  candidates.push(path.join(__dirname, "..", "..", "..", "resources", "skills", "scripts"));

  return [...new Set(candidates)];
}

function skillsReferencesCandidates(): string[] {
  const root = findProjectRoot();
  const candidates: string[] = [];

  if (root) {
    candidates.push(path.join(root, "resources", "skills", "references"));
  }

  candidates.push(path.join(app.getAppPath(), "resources", "skills", "references"));

  if (app.isPackaged) {
    candidates.push(path.join(process.resourcesPath, "skills", "references"));
  }

  candidates.push(path.join(__dirname, "..", "..", "..", "resources", "skills", "references"));

  return [...new Set(candidates)];
}

function resolveSkillsDir(candidates: string[], markerFile: string): string {
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, markerFile))) {
      return dir;
    }
  }
  return candidates[0] ?? path.join(app.getAppPath(), "resources", "skills", "scripts");
}

/** Root directory for vendored Python skill scripts (dev + packaged). */
export function getSkillsScriptsDir(): string {
  return resolveSkillsDir(skillsScriptsCandidates(), "convert_playwright_recording.py");
}

export function getSkillsReferencesDir(): string {
  return resolveSkillsDir(skillsReferencesCandidates(), "bowser-yaml.md");
}
