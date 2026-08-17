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
