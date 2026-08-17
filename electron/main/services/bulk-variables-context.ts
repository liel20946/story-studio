import * as fs from "fs/promises";
import * as path from "path";
import {
  FILE_REF_PREFIX,
  FOLDER_REF_PREFIX,
  parsePathRef,
  storyPathRefVariables,
} from "./variable-path-ref.js";

export interface BulkContextAttachment {
  path: string;
  kind: "file" | "folder";
  name: string;
}

export interface BulkContextFile {
  sourcePath: string;
  relativePath: string;
  content: string;
  truncated: boolean;
}

const MAX_FILES = 40;
const MAX_FILE_BYTES = 48_000;
const MAX_TOTAL_BYTES = 220_000;
const MAX_WALK_DEPTH = 6;

const TEXT_EXTENSIONS = new Set([
  ".html",
  ".htm",
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".csv",
  ".tsv",
  ".xml",
  ".yaml",
  ".yml",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".css",
  ".scss",
  ".less",
  ".svg",
  ".sql",
  ".sh",
  ".env",
  ".ini",
  ".cfg",
  ".conf",
  ".log",
  ".rtf",
]);

function isProbablyText(filePath: string, sample: Buffer): boolean {
  const ext = path.extname(filePath).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) return true;
  if (ext === "") {
    // No extension — allow if sample looks textual.
    const nulls = sample.filter((b) => b === 0).length;
    return nulls === 0;
  }
  return false;
}

async function walkFiles(
  root: string,
  base: string,
  depth: number,
  out: string[],
): Promise<void> {
  if (out.length >= MAX_FILES || depth > MAX_WALK_DEPTH) return;
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (out.length >= MAX_FILES) return;
    if (entry.name.startsWith(".")) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      await walkFiles(full, base, depth + 1, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
}

async function resolveFileList(contextPaths: string[]): Promise<
  Array<{ sourcePath: string; relativePath: string }>
> {
  const collected: Array<{ sourcePath: string; relativePath: string }> = [];
  const seen = new Set<string>();

  for (const raw of contextPaths) {
    if (collected.length >= MAX_FILES) break;
    const abs = path.resolve(raw);
    let stat;
    try {
      stat = await fs.stat(abs);
    } catch {
      continue;
    }
    if (stat.isFile()) {
      if (seen.has(abs)) continue;
      seen.add(abs);
      collected.push({ sourcePath: abs, relativePath: path.basename(abs) });
      continue;
    }
    if (!stat.isDirectory()) continue;
    const nested: string[] = [];
    await walkFiles(abs, abs, 0, nested);
    const folderName = path.basename(abs);
    for (const filePath of nested) {
      if (collected.length >= MAX_FILES) break;
      if (seen.has(filePath)) continue;
      seen.add(filePath);
      collected.push({
        sourcePath: filePath,
        relativePath: path.join(folderName, path.relative(abs, filePath)),
      });
    }
  }
  return collected;
}

export async function loadBulkVariableContext(
  contextPaths: string[],
): Promise<{ attachments: BulkContextAttachment[]; files: BulkContextFile[] }> {
  const uniquePaths = [
    ...new Set(
      contextPaths
        .map((p) => (typeof p === "string" ? p.trim() : ""))
        .filter(Boolean)
        .map((p) => path.resolve(p)),
    ),
  ];

  const attachments: BulkContextAttachment[] = [];
  for (const abs of uniquePaths) {
    try {
      const stat = await fs.stat(abs);
      attachments.push({
        path: abs,
        kind: stat.isDirectory() ? "folder" : "file",
        name: path.basename(abs),
      });
    } catch {
      // skip missing
    }
  }

  const fileList = await resolveFileList(uniquePaths);
  const files: BulkContextFile[] = [];
  let totalBytes = 0;

  for (const item of fileList) {
    if (totalBytes >= MAX_TOTAL_BYTES) break;
    let buf: Buffer;
    try {
      const handle = await fs.open(item.sourcePath, "r");
      try {
        const stat = await handle.stat();
        const readLen = Math.min(stat.size, MAX_FILE_BYTES + 1);
        buf = Buffer.alloc(readLen);
        const { bytesRead } = await handle.read(buf, 0, readLen, 0);
        buf = buf.subarray(0, bytesRead);
      } finally {
        await handle.close();
      }
    } catch {
      continue;
    }

    if (!isProbablyText(item.sourcePath, buf.subarray(0, Math.min(buf.length, 512)))) {
      continue;
    }

    const remaining = MAX_TOTAL_BYTES - totalBytes;
    const softCap = Math.min(MAX_FILE_BYTES, remaining);
    const truncated = buf.length > softCap;
    const slice = buf.subarray(0, softCap);
    const content = slice.toString("utf8");
    totalBytes += Buffer.byteLength(content, "utf8");
    files.push({
      sourcePath: item.sourcePath,
      relativePath: item.relativePath.replace(/\\/g, "/"),
      content,
      truncated,
    });
  }

  return { attachments, files };
}

export async function copyContextFilesToOutput(
  files: BulkContextFile[],
  outputDir: string,
): Promise<string[]> {
  const written: string[] = [];
  const contextRoot = path.join(outputDir, "attachments");
  await fs.mkdir(contextRoot, { recursive: true });

  for (const file of files) {
    const dest = path.join(contextRoot, file.relativePath);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, file.content, "utf8");
    written.push(path.relative(outputDir, dest).replace(/\\/g, "/"));
  }
  return written;
}

export { FILE_REF_PREFIX };
const PREVIEW_CHARS = 280;

function normalizeRel(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function fileBasename(relativePath: string): string {
  const parts = normalizeRel(relativePath).split("/");
  return parts[parts.length - 1] || relativePath;
}

export function payloadVariableKey(keys: string[]): string | undefined {
  return keys.find((k) =>
    /html|content|body|snippet|payload|paste|template|markup/i.test(k),
  );
}

export function inferPayloadKeyFromFile(relativePath: string): string {
  const ext = path.extname(relativePath).toLowerCase();
  if (ext === ".html" || ext === ".htm") return "html_body";
  if (ext === ".json") return "json_body";
  if (ext === ".csv" || ext === ".tsv") return "csv";
  return "content";
}

export function attachmentTargetKey(
  storyVariables: Array<{ key: string; value: string }>,
  relativePath?: string,
): string | undefined {
  const refs = storyPathRefVariables(storyVariables);
  if (relativePath) {
    const stem = fileBasename(relativePath)
      .replace(/\.[^.]+$/, "")
      .toLowerCase();
    const byStem = refs.find((ref) => ref.key.toLowerCase() === stem);
    if (byStem) return byStem.key;
  }
  const fileKey = refs.find((ref) => ref.kind === "file")?.key;
  if (fileKey) return fileKey;
  const folderKey = refs.find((ref) => ref.kind === "folder")?.key;
  if (folderKey) return folderKey;
  return payloadVariableKey(storyVariables.map((variable) => variable.key));
}

function joinFileContents(files: BulkContextFile[]): string {
  if (files.length === 0) return "";
  if (files.length === 1) return files[0].content;
  return files
    .map((file) => `### ${file.relativePath}\n${file.content}`)
    .join("\n\n");
}

function filesForFolder(
  files: BulkContextFile[],
  folderPath: string,
): BulkContextFile[] {
  const abs = path.resolve(folderPath);
  const folderName = path.basename(abs);
  return files.filter((file) => {
    if (file.sourcePath === abs || file.sourcePath.startsWith(`${abs}${path.sep}`)) {
      return true;
    }
    const rel = normalizeRel(file.relativePath);
    return rel === folderName || rel.startsWith(`${folderName}/`);
  });
}

function contentsAlreadyFromAttachments(
  current: string,
  files: BulkContextFile[],
): boolean {
  if (!current) return false;
  return files.some(
    (file) =>
      file.content === current ||
      (current.includes(file.content) && file.content.length > 40),
  );
}

export function lookupAttachedFile(
  files: BulkContextFile[],
  value: string,
): BulkContextFile | undefined {
  const trimmed = value.trim().replace(/^['"]|['"]$/g, "");
  if (!trimmed) return undefined;
  const parsed = parsePathRef(trimmed);
  const ref = parsed
    ? parsed.path
    : trimmed.startsWith(FILE_REF_PREFIX)
      ? trimmed.slice(FILE_REF_PREFIX.length).trim()
      : trimmed.startsWith(FOLDER_REF_PREFIX)
        ? trimmed.slice(FOLDER_REF_PREFIX.length).trim()
        : trimmed;
  const normalized = normalizeRel(ref);
  const exact = files.find((f) => normalizeRel(f.relativePath) === normalized);
  if (exact) return exact;
  const copied = files.find(
    (f) =>
      normalizeRel(`attachments/${f.relativePath}`) === normalized ||
      normalizeRel(f.relativePath) === normalized.replace(/^attachments\//, ""),
  );
  if (copied) return copied;
  const base = fileBasename(normalized);
  const byBase = files.filter((f) => fileBasename(f.relativePath) === base);
  if (byBase.length === 1) return byBase[0];
  return files.find(
    (f) =>
      f.sourcePath === trimmed ||
      f.sourcePath === ref ||
      f.sourcePath.endsWith(normalized),
  );
}

export function lookupAttachedFiles(
  files: BulkContextFile[],
  value: string,
): BulkContextFile[] {
  const trimmed = value.trim().replace(/^['"]|['"]$/g, "");
  if (!trimmed) return [];
  const parsed = parsePathRef(trimmed);
  if (parsed?.kind === "folder") {
    const nested = filesForFolder(files, parsed.path);
    if (nested.length > 0) return nested;
  }
  const single = lookupAttachedFile(files, trimmed);
  return single ? [single] : [];
}

function looksLikeFilenameOnly(value: string): boolean {
  const t = value.trim();
  if (!t) return true;
  if (t.startsWith(FILE_REF_PREFIX) || t.startsWith(FOLDER_REF_PREFIX)) return true;
  if (parsePathRef(t)) return true;
  if (t.includes("\n") || t.length > 240) return false;
  if (/[<>]/.test(t)) return false;
  return (
    /\.(html?|txt|md|json|csv|xml|ya?ml)$/i.test(t) || /attachments\//i.test(t)
  );
}

function fileMatchesRunLabel(file: BulkContextFile, label: string): boolean {
  const base = fileBasename(file.relativePath);
  const stem = base.replace(/\.[^.]+$/, "");
  const needle = label.trim().toLowerCase();
  if (!needle) return false;
  return (
    needle === base.toLowerCase() ||
    needle === stem.toLowerCase() ||
    needle.includes(stem.toLowerCase())
  );
}

function shouldReplaceWithAttachment(current: string, file: BulkContextFile): boolean {
  if (!current || looksLikeFilenameOnly(current)) return true;
  return (
    /[<>]/.test(current) &&
    !file.content.includes(current.trim()) &&
    !current.includes(file.content.trim())
  );
}

export function applyAttachmentContentsToRuns<
  T extends { label: string; variables: Record<string, string> },
>(
  runs: T[],
  files: BulkContextFile[],
  storyVariables: Array<{ key: string; value: string }>,
): T[] {
  if (files.length === 0 || runs.length === 0) return runs;
  const refs = storyPathRefVariables(storyVariables);
  const keys =
    storyVariables.length > 0
      ? storyVariables.map((variable) => variable.key)
      : Array.from(new Set(runs.flatMap((run) => Object.keys(run.variables))));
  const payloadKey = payloadVariableKey(keys);
  const fileTargetKeys = [
    ...refs.filter((ref) => ref.kind === "file").map((ref) => ref.key),
    ...(payloadKey ? [payloadKey] : []),
  ].filter((key, index, all) => all.indexOf(key) === index);
  const folderTargetKeys = refs
    .filter((ref) => ref.kind === "folder")
    .map((ref) => ref.key);

  return runs.map((run, index) => {
    const variables = { ...run.variables };
    for (const [key, value] of Object.entries(variables)) {
      if (/password|secret|token|user|email|login|account/i.test(key)) continue;
      const matched = lookupAttachedFiles(files, value);
      if (matched.length > 0) variables[key] = joinFileContents(matched);
    }

    const labelFile = files.find((item) => fileMatchesRunLabel(item, run.label));
    const file = labelFile ?? files[Math.min(index, files.length - 1)];
    if (!file) return { ...run, variables };

    for (const key of fileTargetKeys) {
      if (/password|secret|token|user|email|login|account/i.test(key)) continue;
      const current = variables[key] ?? "";
      if (contentsAlreadyFromAttachments(current, files)) continue;
      if (shouldReplaceWithAttachment(current, file)) {
        variables[key] = file.content;
      }
    }

    if (fileTargetKeys.length === 0) {
      for (const key of folderTargetKeys) {
        const current = variables[key] ?? "";
        if (contentsAlreadyFromAttachments(current, files)) continue;
        if (!current || looksLikeFilenameOnly(current)) {
          const labeled = files.filter((item) => fileMatchesRunLabel(item, run.label));
          const fromFileDir = filesForFolder(files, path.dirname(file.sourcePath));
          variables[key] = joinFileContents(
            labeled.length > 0 ? labeled : fromFileDir.length > 0 ? fromFileDir : [file],
          );
        }
      }
    }

    return { ...run, variables };
  });
}

export function formatBulkContextForPrompt(
  attachments: BulkContextAttachment[],
  files: BulkContextFile[],
  copiedRelativePaths: string[],
  storyVariables: Array<{ key: string; value: string }> = [],
): string {
  if (attachments.length === 0) return "";

  const attachmentLines = attachments
    .map((a) => `- ${a.kind}: ${a.path}`)
    .join("\n");

  const fileLines =
    files.length === 0
      ? "(no readable text files found in attachments)"
      : files
          .map((file) => {
            const copied =
              copiedRelativePaths.find((p) => p.endsWith(file.relativePath)) ??
              `attachments/${file.relativePath}`;
            const preview = file.content.slice(0, PREVIEW_CHARS).replace(/\s+/g, " ").trim();
            const note = file.truncated ? ", truncated" : "";
            return `- ${copied} (${file.content.length} chars${note}) preview: ${preview}`;
          })
          .join("\n");

  const copiedNote =
    copiedRelativePaths.length > 0
      ? `\nCopied under the working directory as:\n${copiedRelativePaths
          .map((p) => `- ${p}`)
          .join("\n")}`
      : "";

  const examplePath =
    copiedRelativePaths[0] ??
    (files[0] ? `attachments/${files[0].relativePath}` : "attachments/welcome.html");
  const refs = storyPathRefVariables(storyVariables);
  const fileVars = refs
    .filter((ref) => ref.kind === "file")
    .map((ref) => `\`${ref.key}\``)
    .join(", ");
  const folderVars = refs
    .filter((ref) => ref.kind === "folder")
    .map((ref) => `\`${ref.key}\``)
    .join(", ");
  const targetLines = [
    fileVars
      ? `- File variables (${fileVars}): set to "${FILE_REF_PREFIX}${examplePath}". One attached file per run.`
      : null,
    folderVars
      ? `- Folder variables (${folderVars}): set to "${FOLDER_REF_PREFIX}<folder-name>" matching an attached folder.`
      : null,
    !fileVars && !folderVars
      ? `- For payload variables (paste/HTML/body/content), set the value to a file ref only:\n  "${FILE_REF_PREFIX}${examplePath}"`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  return `## Attached context
The user attached files/folders. Story Studio will substitute the real file bytes after you reply.

Critical:
- Do NOT paste raw HTML/JSON/file contents into the JSON (quotes and braces break parsing and can hang the session).
${targetLines}
- One run per attached file when the user asked to vary by file. Label the run after the file name.
- Do not invent substitute markup when an attachment exists.
- Do not copy the story's default @file:/@folder: path; use the attached files above.

### Paths
${attachmentLines}
${copiedNote}

### Files (reference these; do not inline)
${fileLines}`;
}
