import * as fs from "fs/promises";
import * as path from "path";

/** Values bigger than this (or multiline) are written to the run workspace. */
const FILE_BACK_CHARS = 400;

export function shouldFileBackVariable(value: string): boolean {
  return value.length > FILE_BACK_CHARS || /[\n\r]/.test(value);
}

export function variablePayloadPath(key: string): string {
  const safe = key.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80) || "value";
  return `variables/${safe}.txt`;
}

/** Write large/multiline variable payloads so the run prompt stays small. */
export async function writeRunVariableFiles(
  runOutputDir: string,
  variables?: Record<string, string>,
): Promise<string[]> {
  if (!variables) return [];
  const written: string[] = [];
  for (const [key, value] of Object.entries(variables)) {
    if (!shouldFileBackVariable(value)) continue;
    const rel = variablePayloadPath(key);
    const dest = path.join(runOutputDir, rel);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, value, "utf8");
    written.push(rel);
  }
  return written;
}
