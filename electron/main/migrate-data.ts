import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { app } from "./electron-api.js";
import { logger } from "./logger.js";

const MIGRATION_FLAG = ".migrated-from-glaze";

function glazeUserDataPath(): string {
  return path.join(
    os.homedir(),
    "Library",
    "Application Support",
    "app.glaze.macos.eww8eck4-local",
  );
}

/**
 * One-time migration: copy stories, runs, and settings from the old Glaze app data dir.
 */
export async function migrateFromGlazeIfNeeded(): Promise<void> {
  const userData = app.getPath("userData");
  const flagPath = path.join(userData, MIGRATION_FLAG);
  const glazeUserData = glazeUserDataPath();

  try {
    await fs.access(flagPath);
    return;
  } catch {
    // not migrated yet
  }

  try {
    await fs.access(glazeUserData);
  } catch {
    await fs.writeFile(flagPath, new Date().toISOString(), "utf-8");
    return;
  }

  logger.info("migrate", `Migrating data from ${glazeUserData}`);

  for (const dir of ["stories", "runs"] as const) {
    const src = path.join(glazeUserData, dir);
    const dest = path.join(userData, dir);
    try {
      await fs.access(src);
      await fs.mkdir(dest, { recursive: true });
      const entries = await fs.readdir(src, { withFileTypes: true });
      for (const entry of entries) {
        const from = path.join(src, entry.name);
        const to = path.join(dest, entry.name);
        try {
          await fs.access(to);
        } catch {
          if (entry.isDirectory()) {
            await copyDir(from, to);
          } else {
            await fs.copyFile(from, to);
          }
        }
      }
    } catch {
      // source dir missing — skip
    }
  }

  const settingsSrc = path.join(glazeUserData, "settings.json");
  const settingsDest = path.join(userData, "settings.json");
  // Skip settings migration — glaze settings may contain stale paths from another
  // machine/user. Fresh defaults under Electron userData are safer.
  void settingsSrc;
  void settingsDest;

  await fs.writeFile(flagPath, new Date().toISOString(), "utf-8");
  logger.info("migrate", "Migration complete");
}

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(from, to);
    } else {
      await fs.copyFile(from, to);
    }
  }
}
