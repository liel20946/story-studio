import type { AgentProvider } from "./contract-types.js";

/** Fallback labels when capabilities have not been loaded yet. */
export const CODEX_MODELS = [
  { value: "gpt-5.5", label: "GPT-5.5" },
  { value: "gpt-5.4", label: "GPT-5.4" },
  { value: "gpt-5.4-mini", label: "GPT-5.4-Mini" },
] as const;

export const CODEX_EFFORTS = ["low", "medium", "high", "xhigh"] as const;
export const CLAUDE_MODELS = [
  { value: "sonnet", label: "Sonnet" },
  { value: "opus", label: "Opus" },
  { value: "haiku", label: "Haiku" },
] as const;
export const CLAUDE_EFFORTS = ["low", "medium", "high", "max"] as const;

export type CodexModel = string;
export type CodexEffort = string;
export type ClaudeModel = string;
export type ClaudeEffort = string;

export const DEFAULT_CODEX_MODEL = "gpt-5.5";
export const DEFAULT_CODEX_EFFORT = "medium";
export const DEFAULT_CLAUDE_MODEL = "sonnet";
export const DEFAULT_CLAUDE_EFFORT = "medium";

export interface AgentModelSettings {
  codexModel: CodexModel;
  codexEffort: CodexEffort;
  claudeModel: ClaudeModel;
  claudeEffort: ClaudeEffort;
}

export interface AgentRunConfig {
  model: string;
  effort: string;
}

export function defaultAgentModelSettings(): AgentModelSettings {
  return {
    codexModel: DEFAULT_CODEX_MODEL,
    codexEffort: DEFAULT_CODEX_EFFORT,
    claudeModel: DEFAULT_CLAUDE_MODEL,
    claudeEffort: DEFAULT_CLAUDE_EFFORT,
  };
}

export function parseAgentModelSettings(
  parsed: Partial<AgentModelSettings>,
  fallback: AgentModelSettings = defaultAgentModelSettings(),
): AgentModelSettings {
  return {
    codexModel:
      typeof parsed.codexModel === "string" && parsed.codexModel.length > 0
        ? parsed.codexModel
        : fallback.codexModel,
    codexEffort:
      typeof parsed.codexEffort === "string" && parsed.codexEffort.length > 0
        ? parsed.codexEffort
        : fallback.codexEffort,
    claudeModel:
      typeof parsed.claudeModel === "string" && parsed.claudeModel.length > 0
        ? parsed.claudeModel
        : fallback.claudeModel,
    claudeEffort:
      typeof parsed.claudeEffort === "string" && parsed.claudeEffort.length > 0
        ? parsed.claudeEffort
        : fallback.claudeEffort,
  };
}

export function getAgentRunConfig(
  provider: AgentProvider,
  settings: AgentModelSettings,
): AgentRunConfig {
  if (provider === "claude-code") {
    return { model: settings.claudeModel, effort: settings.claudeEffort };
  }
  return { model: settings.codexModel, effort: settings.codexEffort };
}
