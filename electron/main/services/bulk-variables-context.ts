import * as fs from "fs/promises";
import * as path from "path";

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

export function formatBulkContextForPrompt(
  attachments: BulkContextAttachment[],
  files: BulkContextFile[],
  copiedRelativePaths: string[],
): string {
  if (attachments.length === 0) return "";

  const attachmentLines = attachments
    .map((a) => `- ${a.kind}: ${a.path}`)
    .join("\n");

  const fileBlocks = files.map((file, index) => {
    const note = file.truncated ? "\n(truncated for length)" : "";
    return `### File ${index + 1}: ${file.relativePath}${note}\n\`\`\`\n${file.content}\n\`\`\``;
  });

  const copiedNote =
    copiedRelativePaths.length > 0
      ? `\nCopied under the working directory as:\n${copiedRelativePaths
          .map((p) => `- ${p}`)
          .join("\n")}`
      : "";

  return `## Attached context
The user attached these paths so you can put their REAL file contents into variable values.

Critical:
- Copy the file text itself into the relevant variable (e.g. paste/HTML/body/content/payload).
- Do NOT put only a filename or path in the variable.
- Do NOT invent substitute HTML/JSON when an attached file already has the content.
- If several files are attached and the user wants one run per file, make one run per file and use that file's full content.

Example — user attaches \`welcome.html\` containing:
\`\`\`html
<html><body><h1>Welcome</h1><p>Hello Alice</p></body></html>
\`\`\`
and asks for a run that pastes that HTML into \`html_body\`. Correct variables entry:
\`\`\`json
{ "label": "welcome", "variables": { "html_body": "<html><body><h1>Welcome</h1><p>Hello Alice</p></body></html>" } }
\`\`\`
Wrong: \`{ "html_body": "welcome.html" }\` or invented markup.

### Paths
${attachmentLines}
${copiedNote}

### File contents (use these literally)
${fileBlocks.join("\n\n") || "(no readable text files found in attachments)"}`;
}
