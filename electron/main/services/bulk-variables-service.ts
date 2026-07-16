import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { randomUUID } from "crypto";
import type { AppSettings, BulkVariableRun, StoryDetail } from "./contract-types.js";
import { getStory } from "./stories-service.js";
import { buildLastRunMap, listRuns } from "./run-service.js";
import { buildBulkVariablesPrompt } from "./bulk-variables-skill.js";
import { invokeGenerateAgent, cancelGenerateInvocation } from "./agent-generate-runner.js";
import { resolveAgentBinary } from "./agent-provider.js";
import { getAgentRunConfig } from "./agent-config.js";
import { mockRunsEnabled } from "./mock-runner.js";

export interface BulkVariablesGenerateResult {
  runs: BulkVariableRun[];
}

function parseRunsFromAgentMessage(raw: string): BulkVariableRun[] {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced || trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("Agent response did not contain JSON");
  }
  const parsed = JSON.parse(candidate.slice(start, end + 1)) as {
    runs?: Array<{ label?: string; variables?: Record<string, string> }>;
  };
  if (!Array.isArray(parsed.runs) || parsed.runs.length === 0) {
    throw new Error("Agent JSON must include a non-empty runs array");
  }
  return parsed.runs.map((run, index) => ({
    id: randomUUID(),
    label: (run.label?.trim() || `Run ${index + 1}`).slice(0, 80),
    variables: Object.fromEntries(
      Object.entries(run.variables ?? {}).map(([k, v]) => [k, String(v)]),
    ),
  }));
}

function varyEmailLike(value: string, index: number): string {
  const at = value.indexOf("@");
  if (at <= 0) return value;
  const local = value.slice(0, at);
  const domain = value.slice(at);
  if (index === 0) return value;
  if (local.includes("+")) return `${local}.r${index}${domain}`;
  return `${local}+${index + 1}${domain}`;
}

function mockRunsForStory(story: StoryDetail, description: string): BulkVariableRun[] {
  const storyVars =
    story.variables.length > 0
      ? story.variables
      : [
          { key: "email", value: "", secret: false },
          { key: "password", value: "", secret: true },
        ];
  const countMatch = description.match(/\b(\d+)\b/);
  const count = Math.min(4, Math.max(2, countMatch ? Number(countMatch[1]) : 2));
  const labels = ["Admin", "Guest", "Editor", "Viewer"];
  const wantsEmailVariation = /email|user|login|account/i.test(description);
  const runs: BulkVariableRun[] = [];
  for (let i = 0; i < count; i++) {
    const variables: Record<string, string> = {};
    for (const variable of storyVars) {
      const base = variable.value ?? "";
      if (variable.secret || !base) {
        variables[variable.key] = base;
        continue;
      }
      if (wantsEmailVariation && base.includes("@")) {
        variables[variable.key] = varyEmailLike(base, i);
      } else {
        variables[variable.key] = base;
      }
    }
    runs.push({
      id: randomUUID(),
      label: labels[i] ?? `Run ${i + 1}`,
      variables,
    });
  }
  return runs;
}

export async function generateBulkVariableRuns(
  storyName: string,
  description: string,
  settings: AppSettings,
  invocationId: string,
  onProgress?: (message: string) => void,
): Promise<BulkVariablesGenerateResult> {
  const trimmed = description.trim();
  if (!trimmed) throw new Error("Description cannot be empty");

  const runs = await listRuns();
  const lastRunMap = buildLastRunMap(runs);
  const story = await getStory(storyName, lastRunMap);

  if (mockRunsEnabled()) {
    onProgress?.("Generating variable sets…");
    await new Promise((r) => setTimeout(r, 600));
    return { runs: mockRunsForStory(story, trimmed) };
  }

  const outputDir = path.join(os.tmpdir(), "story-studio-bulk-vars", invocationId);
  await fs.mkdir(outputDir, { recursive: true });

  const agentBinary = await resolveAgentBinary(
    settings.agentProvider,
    settings.codexBinaryPath,
    settings.claudeBinaryPath,
  );
  const agentConfig = getAgentRunConfig(settings.agentProvider, settings);

  const { message } = await invokeGenerateAgent({
    conversationId: invocationId,
    invocationId,
    prompt: buildBulkVariablesPrompt(story, trimmed),
    outputDir,
    provider: settings.agentProvider,
    agentBinary,
    agentConfig,
    exploring: false,
    ephemeral: true,
    onProgress,
  });

  const parsedRuns = parseRunsFromAgentMessage(message);
  applyStoryVariableDefaults(story, parsedRuns);
  return { runs: parsedRuns };
}

function isCredentialKey(key: string): boolean {
  return /password|secret|token|user|email|login|account/i.test(key);
}

function looksInventedCredential(agentValue: string, original: string): boolean {
  if (!original || agentValue === original) return false;
  if (original.includes("@")) {
    const domain = original.slice(original.indexOf("@") + 1).toLowerCase();
    if (domain && agentValue.toLowerCase().includes(domain)) return false;
    if (
      /example\.com|email\.com|test\.com|placeholder/i.test(agentValue) &&
      !/example\.com|email\.com|test\.com/i.test(original)
    ) {
      return true;
    }
  }
  if (/^(user|admin|guest|test)\d*$/i.test(agentValue) && !/^(user|admin|guest|test)\d*$/i.test(original)) {
    return true;
  }
  return false;
}

function applyStoryVariableDefaults(story: StoryDetail, runs: BulkVariableRun[]): void {
  if (story.variables.length === 0) return;
  for (const run of runs) {
    for (const variable of story.variables) {
      const current = run.variables[variable.key];
      // Secrets always keep the story default so the agent cannot invent them.
      if (variable.secret) {
        run.variables[variable.key] = variable.value;
        continue;
      }
      if (current === undefined || current === "") {
        run.variables[variable.key] = variable.value;
        continue;
      }
      if (
        variable.value &&
        isCredentialKey(variable.key) &&
        looksInventedCredential(current, variable.value)
      ) {
        run.variables[variable.key] = variable.value;
      }
    }
  }
}

export function cancelBulkVariablesGenerate(invocationId: string): boolean {
  return cancelGenerateInvocation(invocationId);
}
