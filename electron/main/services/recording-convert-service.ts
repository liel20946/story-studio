import { spawn, type ChildProcess } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import { stringify as stringifyYaml } from "yaml";
import { BOWSER_STORY_FORMAT } from "./story-skill.js";
import { buildCodexConversionConfigArgs } from "./codex-mcp-config.js";
import {
  normalizeBowserEntryForStorage,
  validateBowserEntry,
  slugify,
  type BowserStoryEntry,
} from "./bowser-stories-service.js";
import { parseDraftYamlSnippet } from "./stories-service.js";

const CONVERSION_MODEL = "gpt-5.5";
const CONVERSION_TIMEOUT_MS = 120_000;

export function buildRecordingConversionPrompt(
  script: string,
  url: string,
  options?: { name?: string; storyId?: string; siteSlug?: string },
): string {
  const idHint = options?.storyId
    ? `- Use story id: ${options.storyId}`
    : `- Choose a kebab-case story id like ${options?.siteSlug ?? "site"}-area-purpose`;
  const nameHint = options?.name
    ? `- Use story name (human title): ${options.name}`
    : "- Choose a short human-readable story name from the recorded flow";

  return (
    `IMPORTANT: This is a TEXT-ONLY transformation. Do NOT run shell commands, execute the script, ` +
    `open a browser, install packages, or use any MCP/tools. Read the script below and reply with YAML only.\n\n` +
    `Convert the following recorded Playwright codegen script into an intent-level Bowser YAML v2 story.\n\n` +
    `${BOWSER_STORY_FORMAT}\n\n` +
    `Requirements:\n` +
    `- Return a YAML document with a top-level \`stories:\` array containing exactly one story entry.\n` +
    `- Capture typed values in a \`variables:\` map (e.g. login_email, login_password, account_name) and reference them in Fill steps as \`{{variable_name}}\`.\n` +
    `- Write workflow steps as intent, not raw selectors. Use Navigate, Click, Fill, Select, Press.\n` +
    `- Put checks in a separate \`assertions:\` block (not in workflow). One assertion per line, prefixed with \`@N\` where N is how many workflow steps have completed before the check (0 before the first step; with 14 workflow steps the last check is \`@14\`, never \`@15\`).\n` +
    `- End-state rule (critical): recordings often end with the user clicking a row, link, or tab AFTER the main action to land on the screen they want as the final screenshot. Keep every such trailing Click/Navigate in workflow. Place the final assertion at \`@<workflow step count>\` (equal to the number of workflow lines) and describe that destination page — not an intermediate list, table, or toast they immediately clicked past.\n` +
    `- Example: after issuing store credit the user may click the customer wallet row to open its detail page. Workflow must include that click; the final assertion at \`@N\` (after all steps) should verify the wallet detail page, while an earlier assertion may verify the success toast or updated list.\n` +
    `- Include at least one assertion. For dynamic values (dates, times, counts, totals, prices, IDs, confirmation numbers), verify format/pattern/relative condition — never hardcode literals that change between runs.\n` +
    `- Set mode: recorded\n` +
    `- Set url: ${url}\n` +
    `${idHint}\n` +
    `${nameHint}\n\n` +
    `Return ONLY the YAML document — no markdown fences, no explanation. Do not write any file.\n\n` +
    `Script:\n${script}`
  );
}

export function extractYamlFromAgentMessage(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:ya?ml)?\s*\n([\s\S]*?)\n```/i);
  if (fenced) return fenced[1].trim();
  const storiesIdx = trimmed.search(/^stories:\s*$/m);
  if (storiesIdx >= 0) return trimmed.slice(storiesIdx).trim();
  return trimmed;
}

function parseAgentMessageFromCodexStdout(stdout: string): string {
  let lastAgentMessage = "";
  let buffer = "";
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    buffer += line + "\n";
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const jsonLine of lines) {
      if (!jsonLine.trim()) continue;
      try {
        const parsed = JSON.parse(jsonLine) as Record<string, unknown>;
        const type = parsed["type"] as string | undefined;
        if (type !== "item.completed" && type !== "item.updated") continue;
        const item = parsed["item"] as Record<string, unknown> | undefined;
        if (item?.["type"] === "agent_message") {
          const text = (item["text"] as string | undefined) ?? "";
          if (text.trim()) lastAgentMessage = text;
        }
      } catch {
        // ignore non-JSON lines
      }
    }
  }
  return lastAgentMessage;
}

function progressFromCodexLine(line: string): string | null {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    const type = parsed["type"] as string | undefined;
    if (type === "turn.started") {
      return "Converting recording using AI…";
    }
    if (type === "item.started") {
      const item = parsed["item"] as Record<string, unknown> | undefined;
      if (item?.["type"] === "reasoning") {
        return "Analyzing recording using AI…";
      }
      if (item?.["type"] === "command_execution") {
        return "Processing recording using AI… (retry if this hangs)";
      }
    }
    if (type === "turn.completed" || type === "item.completed") {
      return "Finishing story using AI…";
    }
  } catch {
    // ignore
  }
  return null;
}

function normalizeConvertedEntry(
  entry: BowserStoryEntry,
  options: { url: string; name?: string; storyId?: string },
): BowserStoryEntry {
  const normalized = normalizeBowserEntryForStorage({
    ...entry,
    id: options.storyId ?? entry.id,
    name: options.name ?? entry.name,
    url: options.url,
    mode: "recorded",
  });

  if (!normalized.id?.trim()) {
    normalized.id = slugify(normalized.name || "recorded-flow");
  }

  const errors = validateBowserEntry(normalized);
  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }

  return normalized;
}

export async function convertRecordingWithCodex(
  script: string,
  outputDir: string,
  codexBinary: string,
  _runsDir: string,
  options: { url: string; name?: string; storyId?: string; siteSlug: string },
  buildEnv: () => NodeJS.ProcessEnv,
  onProgress?: (message: string) => void,
): Promise<{ draftYaml: string }> {
  await fs.mkdir(outputDir, { recursive: true });

  const convertPrompt = buildRecordingConversionPrompt(script, options.url, {
    name: options.name,
    storyId: options.storyId,
    siteSlug: options.siteSlug,
  });
  const lastMessagePath = path.join(outputDir, "codex-last-message.txt");

  const convertArgs = [
    "exec",
    "--dangerously-bypass-approvals-and-sandbox",
    "--skip-git-repo-check",
    "--ephemeral",
    "--json",
    "--ignore-user-config",
    "-C",
    outputDir,
    "-c",
    `model="${CONVERSION_MODEL}"`,
    ...buildCodexConversionConfigArgs(),
    "-o",
    lastMessagePath,
    convertPrompt,
  ];

  console.log("[recording] spawning codex for conversion", {
    name: options.name,
    codexBinary,
    storyId: options.storyId,
    lastMessagePath,
  });

  const agentMessage = await new Promise<string>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let stdoutBuffer = "";
    let settled = false;
    let child: ChildProcess | null = null;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const timer = setTimeout(() => {
      console.error("[recording] codex conversion timed out", { storyId: options.storyId });
      try {
        child?.kill("SIGTERM");
      } catch {
        // ignore
      }
      finish(() => {
        reject(
          new Error(
            "Codex conversion timed out after 2 minutes. Try again, or check that Codex CLI is logged in.",
          ),
        );
      });
    }, CONVERSION_TIMEOUT_MS);

    child = spawn(codexBinary, convertArgs, {
      cwd: outputDir,
      env: buildEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      stdout += text;
      stdoutBuffer += text;
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) {
        const progress = progressFromCodexLine(line);
        if (progress) onProgress?.(progress);
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      stderr += text;
      const trimmed = text.trim();
      if (trimmed) console.error("[recording] convert stderr:", trimmed);
    });

    child.on("error", (err) => {
      finish(() => reject(new Error(`Codex conversion failed: ${err.message}`)));
    });

    child.on("close", async (code) => {
      try {
        let message = "";
        try {
          message = (await fs.readFile(lastMessagePath, "utf-8")).trim();
        } catch {
          // fall back to JSONL parsing
        }
        if (!message) {
          message = parseAgentMessageFromCodexStdout(stdout);
        }
        if (!message.trim()) {
          const detail = stderr.trim() || `exit code ${code ?? "?"}`;
          finish(() => reject(new Error(`Codex did not produce story content. ${detail}`)));
          return;
        }
        finish(() => resolve(message));
      } catch (err) {
        finish(() => reject(err));
      }
    });
  });

  const yamlSnippet = extractYamlFromAgentMessage(agentMessage);
  let entry: BowserStoryEntry;
  try {
    entry = parseDraftYamlSnippet(yamlSnippet);
  } catch (err) {
    throw new Error(
      `Codex returned invalid YAML: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const normalized = normalizeConvertedEntry(entry, options);
  const draftYaml = stringifyYaml({ stories: [normalized] });
  await fs.writeFile(path.join(outputDir, "draft.story.yaml"), draftYaml, "utf-8");

  return { draftYaml };
}
