import * as path from "path";
import { app } from "../electron-api.js";

/** Root directory for vendored Python skill scripts (dev + packaged). */
export function getSkillsScriptsDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "skills", "scripts");
  }
  return path.join(app.getAppPath(), "resources", "skills", "scripts");
}

export function getSkillsReferencesDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "skills", "references");
  }
  return path.join(app.getAppPath(), "resources", "skills", "references");
}
