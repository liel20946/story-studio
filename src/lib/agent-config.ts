import type { AgentProvider, AgentModelOverride } from "./contract-types";

/** Fallback labels when capabilities have not been loaded yet. */
export const CODEX_MODELS = [
  { value: "gpt-5.5", label: "GPT-5.5" },
  { value: "gpt-5.4", label: "GPT-5.4" },
  { value: "gpt-5.4-mini", label: "GPT-5.4-Mini" },
] as const;

export const CODEX_EFFORTS = ["low", "medium", "high", "xhigh"] as const;
export const CLAUDE_MODELS = [
  { value: "opus", label: "Opus" },
  { value: "sonnet", label: "Sonnet" },
  { value: "haiku", label: "Haiku" },
] as const;
export const CLAUDE_EFFORTS = ["low", "medium", "high", "max"] as const;

export type CodexModel = string;
export type CodexEffort = string;
export type ClaudeModel = string;
export type ClaudeEffort = string;

export type AgentModelOption = { value: string; label: string };

export interface AgentCapabilities {
  provider: AgentProvider;
  models: AgentModelOption[];
  effortsByModel: Record<string, string[]>;
  defaultModel: string;
  defaultEffort: string;
  source: "codex-catalog" | "claude-static" | "claude-settings" | "fallback";
  error?: string;
}

export function getModelOptions(
  provider: AgentProvider,
  capabilities?: AgentCapabilities | null,
) {
  if (capabilities?.provider === provider && capabilities.models.length > 0) {
    return capabilities.models;
  }
  return provider === "claude-code" ? CLAUDE_MODELS : CODEX_MODELS;
}

export function getModelSegmentOptions(
  provider: AgentProvider,
  capabilities?: AgentCapabilities | null,
) {
  return getModelOptions(provider, capabilities).map((opt) => ({
    value: opt.value,
    label: opt.label,
  }));
}

export function getEffortOptions(
  provider: AgentProvider,
  model: string,
  capabilities?: AgentCapabilities | null,
) {
  if (capabilities?.provider === provider) {
    const efforts =
      capabilities.effortsByModel[model] ??
      capabilities.effortsByModel[capabilities.defaultModel];
    if (efforts?.length) return efforts;
  }
  return provider === "claude-code" ? [...CLAUDE_EFFORTS] : [...CODEX_EFFORTS];
}

export function getEffortSegmentOptions(
  provider: AgentProvider,
  model: string,
  capabilities?: AgentCapabilities | null,
) {
  return getEffortOptions(provider, model, capabilities).map((effort) => ({
    value: effort,
    label: formatEffortLabel(effort),
  }));
}

export function formatEffortLabel(effort: string): string {
  if (effort === "xhigh") return "X High";
  return effort.charAt(0).toUpperCase() + effort.slice(1);
}

export function segmentClassForCount(count: number): string {
  if (count <= 2) return "segment-control--labeled";
  if (count === 3) return "segment-control--labeled segment-control--three";
  if (count === 4) return "segment-control--labeled segment-control--four";
  if (count === 5) return "segment-control--labeled segment-control--five";
  return "segment-control--labeled segment-control--six";
}

export function modelSegmentClass(
  provider: AgentProvider,
  capabilities?: AgentCapabilities | null,
): string {
  const count = getModelOptions(provider, capabilities).length;
  return segmentClassForCount(count);
}

export function effortSegmentClass(
  provider: AgentProvider,
  model: string,
  capabilities?: AgentCapabilities | null,
): string {
  const count = getEffortOptions(provider, model, capabilities).length;
  return segmentClassForCount(count);
}

export function formatAgentProviderLabel(provider: AgentProvider): string {
  return provider === "claude-code" ? "Claude Code" : "Codex";
}

export function formatAgentModelLabel(
  provider: AgentProvider,
  model: string,
  capabilities?: AgentCapabilities | null,
): string {
  const options = getModelOptions(provider, capabilities);
  return options.find((opt) => opt.value === model)?.label ?? model;
}

export function formatChatModelLabel(
  provider: AgentProvider,
  model: string,
  effort: string,
  capabilities?: AgentCapabilities | null,
): string {
  const modelLabel = formatAgentModelLabel(provider, model, capabilities);
  return `${modelLabel} ${formatEffortLabel(effort)}`;
}

export interface ChatModelOption {
  model: string;
  effort: string;
  label: string;
}

export function buildChatModelOptions(
  provider: AgentProvider,
  capabilities?: AgentCapabilities | null,
): ChatModelOption[] {
  const options: ChatModelOption[] = [];
  for (const model of getModelOptions(provider, capabilities)) {
    for (const effort of getEffortOptions(provider, model.value, capabilities)) {
      options.push({
        model: model.value,
        effort,
        label: formatChatModelLabel(provider, model.value, effort, capabilities),
      });
    }
  }
  return options;
}

export function getDefaultChatModelSelection(
  provider: AgentProvider,
  settings: {
    codexModel: string;
    codexEffort: string;
    claudeModel: string;
    claudeEffort: string;
  },
): AgentModelOverride {
  if (provider === "claude-code") {
    return { model: settings.claudeModel, effort: settings.claudeEffort };
  }
  return { model: settings.codexModel, effort: settings.codexEffort };
}
