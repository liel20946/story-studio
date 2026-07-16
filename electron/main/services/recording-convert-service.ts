import * as fs from "fs/promises";
import * as path from "path";
import { stringify as stringifyYaml } from "yaml";
import type { AgentProvider } from "./contract-types.js";
import type { AgentRunConfig } from "./agent-config.js";
import { BOWSER_STORY_FORMAT } from "./story-skill.js";
import { invokeGenerateAgent } from "./agent-generate-runner.js";
import {
  normalizeBowserEntryForStorage,
  validateBowserEntry,
  slugify,
  type BowserStoryEntry,
} from "./bowser-stories-service.js";
import { parseDraftYamlSnippet } from "./stories-service.js";

type StoryHints = { name?: string; storyId?: string; siteSlug?: string };

function storyHintLines(url: string, options?: StoryHints): string {
  const idHint = options?.storyId
    ? `- Use story id: ${options.storyId}`
    : `- Choose a kebab-case story id like ${options?.siteSlug ?? "site"}-area-purpose`;
  const nameHint = options?.name
    ? `- Use story name (human title): ${options.name}`
    : "- Choose a short human-readable story name from the recorded flow";
  return (
    `- Set mode: recorded\n` +
    `- Set url: ${url}\n` +
    `${idHint}\n` +
    `${nameHint}`
  );
}

const RECORDING_YAML_REQUIREMENTS =
  `Requirements:\n` +
  `- Return a YAML document with a top-level \`stories:\` array containing exactly one story entry.\n` +
  `- Capture typed values in a \`variables:\` map (e.g. login_email, login_password, account_name) and reference them in Fill steps as \`{{variable_name}}\`.\n` +
  `- Write workflow steps as intent, not raw selectors. Use Navigate, Click, Fill, Select, Press.\n` +
  `- Put checks in a separate \`assertions:\` block (not in workflow). One assertion per line, prefixed with \`@N\` where N is how many workflow steps have completed before the check (0 before the first step; with 14 workflow steps the last check is \`@14\`, never \`@15\`).\n` +
  `- End-state rule (critical): recordings often end with the user clicking a row, link, or tab AFTER the main action to land on the screen they want as the final screenshot. Keep every such trailing Click/Navigate in workflow. Place the final assertion at \`@<workflow step count>\` (equal to the number of workflow lines) and describe that destination page — not an intermediate list, table, or toast they immediately clicked past.\n` +
  `- Example: after submitting a form the user may click a result row to open its detail page. Workflow must include that click; the final assertion at \`@N\` (after all steps) should verify the detail page, while an earlier assertion may verify the success message or updated list.\n` +
  `- Include at least one assertion. For dynamic values (dates, times, counts, totals, prices, IDs, confirmation numbers), verify format/pattern/relative condition — never hardcode literals that change between runs.\n`;

export function buildRecordingConversionPrompt(
  script: string,
  url: string,
  options?: StoryHints,
): string {
  return (
    `IMPORTANT: This is a TEXT-ONLY transformation. Do NOT run shell commands, execute the script, ` +
    `open a browser, install packages, or use any MCP/tools. Read the script below and reply with YAML only.\n\n` +
    `Convert the following recorded Playwright codegen script into an intent-level Bowser YAML v2 story.\n\n` +
    `${BOWSER_STORY_FORMAT}\n\n` +
    `${RECORDING_YAML_REQUIREMENTS}` +
    `${storyHintLines(url, options)}\n\n` +
    `Return ONLY the YAML document — no markdown fences, no explanation. Do not write any file.\n\n` +
    `Script:\n${script}`
  );
}

/** Prompt for Chrome DevTools / Computer Use recordings (no codegen script). */
export function buildObservedRecordingConversionPrompt(
  url: string,
  tool: "chrome-devtools" | "computer-use",
  options?: StoryHints,
): string {
  const toolBlock =
    tool === "computer-use"
      ? `## Observation tool — @Computer\n` +
        `- Start with @Computer. Inspect the **already open** Google Chrome tab from this recording.\n` +
        `- Do NOT open a new Chrome window or a new tab. Use the existing tab the user just finished in.\n` +
        `- Reconstruct the user's flow from the final page, URL, visible UI, and back/forward history when available.\n` +
        `- Do NOT use Playwright MCP, Chrome DevTools MCP, Playwright CLI, the Codex in-app @Browser, Cursor, or headless browsers.\n`
      : `## Observation tool — Chrome DevTools MCP\n` +
        `- Use Chrome DevTools MCP connected to the user's **already running** Google Chrome (autoConnect).\n` +
        `- Find the existing tab for this recording (started at the URL below). Do NOT open a new Chrome window or a fresh browser.\n` +
        `- Inspect the current page, navigation history, and DOM to reconstruct the user's flow.\n` +
        `- Do NOT use Playwright MCP, Computer Use, Cursor, or headless browsers.\n`;

  return (
    `You are converting a just-finished manual browser recording into an intent-level Bowser YAML v2 story.\n\n` +
    `${toolBlock}\n` +
    `The user started at ${url} and performed actions in their existing Google Chrome, ending on the page they want as the final screenshot.\n` +
    `Reconstruct the workflow they performed — do not invent unrelated steps.\n\n` +
    `${BOWSER_STORY_FORMAT}\n\n` +
    `${RECORDING_YAML_REQUIREMENTS}` +
    `${storyHintLines(url, options)}\n\n` +
    `Return ONLY the YAML document — no markdown fences, no explanation. Do not write any file.`
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

export function parseAgentMessageFromCodexStdout(stdout: string): string {
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

function agentProviderLabel(provider: AgentProvider): string {
  return provider === "claude-code" ? "Claude Code" : "Codex";
}

async function finalizeConvertedYaml(
  agentMessage: string,
  outputDir: string,
  options: {
    url: string;
    name?: string;
    storyId?: string;
    provider: AgentProvider;
  },
): Promise<{ draftYaml: string }> {
  const yamlSnippet = extractYamlFromAgentMessage(agentMessage);
  let entry: BowserStoryEntry;
  try {
    entry = parseDraftYamlSnippet(yamlSnippet);
  } catch (err) {
    const label = agentProviderLabel(options.provider);
    throw new Error(
      `${label} returned invalid YAML: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const normalized = normalizeConvertedEntry(entry, options);
  const draftYaml = stringifyYaml({ stories: [normalized] });
  await fs.writeFile(path.join(outputDir, "draft.story.yaml"), draftYaml, "utf-8");
  return { draftYaml };
}

async function invokeConversionAgent(
  convertPrompt: string,
  outputDir: string,
  options: {
    name?: string;
    storyId?: string;
    provider: AgentProvider;
    agentBinary: string;
    agentConfig: AgentRunConfig;
    exploring: boolean;
    browserMcp?: "playwright" | "chrome-devtools";
    computerUse?: boolean;
    chromeBrowserUrl?: string;
    chromeAutoConnect?: boolean;
  },
  onProgress?: (message: string) => void,
): Promise<string> {
  const invocationId = `recording:${path.basename(outputDir)}`;
  console.log("[recording] converting with agent", {
    name: options.name,
    provider: options.provider,
    model: options.agentConfig.model,
    storyId: options.storyId,
    exploring: options.exploring,
    computerUse: options.computerUse,
    browserMcp: options.browserMcp,
    chromeAutoConnect: options.chromeAutoConnect,
  });

  onProgress?.("Converting recording using AI…");

  try {
    const invokeResult = await invokeGenerateAgent({
      conversationId: invocationId,
      invocationId,
      prompt: convertPrompt,
      outputDir,
      provider: options.provider,
      agentBinary: options.agentBinary,
      agentConfig: options.agentConfig,
      exploring: options.exploring,
      ephemeral: true,
      browserMcp: options.browserMcp,
      computerUse: options.computerUse,
      chromeBrowserUrl: options.chromeBrowserUrl,
      chromeAutoConnect: options.chromeAutoConnect,
      onProgress: (message) => onProgress?.(message),
    });
    return invokeResult.message;
  } catch (err) {
    const label = agentProviderLabel(options.provider);
    const detail = err instanceof Error ? err.message : String(err);
    if (detail.includes("timed out")) {
      throw new Error(
        `${label} conversion timed out. Try again, or check that ${label} CLI is logged in.`,
      );
    }
    throw new Error(`${label} conversion failed: ${detail}`);
  }
}

export async function convertRecordingWithAgent(
  script: string,
  outputDir: string,
  options: {
    url: string;
    name?: string;
    storyId?: string;
    siteSlug: string;
    provider: AgentProvider;
    agentBinary: string;
    agentConfig: AgentRunConfig;
  },
  onProgress?: (message: string) => void,
): Promise<{ draftYaml: string }> {
  await fs.mkdir(outputDir, { recursive: true });

  const convertPrompt = buildRecordingConversionPrompt(script, options.url, {
    name: options.name,
    storyId: options.storyId,
    siteSlug: options.siteSlug,
  });

  const agentMessage = await invokeConversionAgent(
    convertPrompt,
    outputDir,
    {
      name: options.name,
      storyId: options.storyId,
      provider: options.provider,
      agentBinary: options.agentBinary,
      agentConfig: options.agentConfig,
      exploring: false,
    },
    onProgress,
  );

  return finalizeConvertedYaml(agentMessage, outputDir, options);
}

/** Convert a headed Chrome / Computer Use recording by observing the live session. */
export async function convertObservedRecordingWithAgent(
  outputDir: string,
  options: {
    url: string;
    name?: string;
    storyId?: string;
    siteSlug: string;
    provider: AgentProvider;
    agentBinary: string;
    agentConfig: AgentRunConfig;
    tool: "chrome-devtools" | "computer-use";
    chromeBrowserUrl?: string;
  },
  onProgress?: (message: string) => void,
): Promise<{ draftYaml: string }> {
  await fs.mkdir(outputDir, { recursive: true });

  const convertPrompt = buildObservedRecordingConversionPrompt(
    options.url,
    options.tool,
    {
      name: options.name,
      storyId: options.storyId,
      siteSlug: options.siteSlug,
    },
  );

  const computerUse = options.tool === "computer-use";
  const agentMessage = await invokeConversionAgent(
    convertPrompt,
    outputDir,
    {
      name: options.name,
      storyId: options.storyId,
      provider: options.provider,
      agentBinary: options.agentBinary,
      agentConfig: options.agentConfig,
      exploring: true,
      browserMcp: computerUse ? undefined : "chrome-devtools",
      computerUse,
      chromeBrowserUrl: options.chromeBrowserUrl,
      chromeAutoConnect: !computerUse && !options.chromeBrowserUrl,
    },
    onProgress,
  );

  return finalizeConvertedYaml(agentMessage, outputDir, options);
}
