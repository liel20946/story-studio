export const FILE_REF_PREFIX = "@file:";
export const FOLDER_REF_PREFIX = "@folder:";

export type VariablePathKind = "file" | "folder";

export function formatPathRef(kind: VariablePathKind, absPath: string): string {
  const prefix = kind === "folder" ? FOLDER_REF_PREFIX : FILE_REF_PREFIX;
  return `${prefix}${absPath}`;
}

export function parsePathRef(
  value: string,
): { kind: VariablePathKind; path: string } | null {
  const trimmed = value.trim();
  if (trimmed.startsWith(FOLDER_REF_PREFIX)) {
    const filePath = trimmed.slice(FOLDER_REF_PREFIX.length).trim();
    return filePath ? { kind: "folder", path: filePath } : null;
  }
  if (trimmed.startsWith(FILE_REF_PREFIX)) {
    const filePath = trimmed.slice(FILE_REF_PREFIX.length).trim();
    return filePath ? { kind: "file", path: filePath } : null;
  }
  return null;
}

export function pathRefLabel(value: string): string | null {
  const parsed = parsePathRef(value);
  if (!parsed) return null;
  const parts = parsed.path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || parsed.path;
}

export function pathStem(filePath: string): string {
  const base = filePath.replace(/\\/g, "/").split("/").pop() || "content";
  const stem = base.replace(/\.[^.]+$/, "") || base;
  return stem.replace(/[^A-Za-z0-9_]+/g, "_").slice(0, 40) || "content";
}
