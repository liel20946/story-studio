import { execFile } from "child_process";
import * as path from "path";
import { promisify } from "util";
import type { AgentProvider } from "./contract-types.js";
import { resolveAgentBinary } from "./agent-provider.js";
import { loadClaudeAvailableModels } from "./claude-settings.js";
import { getRunsDir, getStoriesDir } from "./paths.js";

const execFileAsync = promisify(execFile);

export interface AgentModelOption {
  value: string;
  label: string;
}

export interface AgentCapabilities {
  provider: AgentProvider;
  models: AgentModelOption[];
  /** Effort levels supported for each model slug / alias. */
  effortsByModel: Record<string, string[]>;
  defaultModel: string;
  defaultEffort: string;
  /** Where the option list came from. */
  source: "codex-catalog" | "claude-static" | "claude-settings" | "fallback";
  error?: string;
}

export interface AgentCapabilitiesSnapshot {
  codex: AgentCapabilities;
  claude: AgentCapabilities;
}

const CLAUDE_EFFORTS = ["low", "medium", "high", "max"] as const;

const CLAUDE_PRIMARY_ALIASES = [
  { value: "opus", label: "Opus", family: "opus" },
  { value: "sonnet", label: "Sonnet", family: "sonnet" },
  { value: "haiku", label: "Haiku", family: "haiku" },
  { value: "fable", label: "Fable", family: "fable" },
] as const;

const CLAUDE_FALLBACK_MODELS: AgentModelOption[] = CLAUDE_PRIMARY_ALIASES.slice(0, 3).map(
  (alias) => ({ value: alias.value, label: alias.label }),
);

const CODEX_FALLBACK_MODELS: AgentModelOption[] = [
  { value: "gpt-5.5", label: "GPT-5.5" },
  { value: "gpt-5.4", label: "GPT-5.4" },
  { value: "gpt-5.4-mini", label: "GPT-5.4-Mini" },
];

const CODEX_FALLBACK_EFFORTS = ["low", "medium", "high", "xhigh"] as const;

interface CodexCatalogModel {
  slug: string;
  display_name: string;
  visibility?: string;
  default_reasoning_level?: string;
  supported_reasoning_levels?: Array<{ effort: string }>;
}

let _cache: Partial<Record<AgentProvider, AgentCapabilities>> = {};
let _warmed = false;

function effortsForAllModels(
  models: AgentModelOption[],
  efforts: readonly string[],
): Record<string, string[]> {
  return Object.fromEntries(models.map((m) => [m.value, [...efforts]]));
}

function isClaudeAliasAllowed(
  alias: (typeof CLAUDE_PRIMARY_ALIASES)[number],
  availableModels: string[],
): boolean {
  if (availableModels.length === 0) return alias.value !== "fable";

  return availableModels.some((entry) => {
    if (entry === alias.value || entry === alias.family) return true;
    if (entry.startsWith("claude-")) {
      if (alias.family === "opus" && entry.includes("opus")) return true;
      if (alias.family === "sonnet" && entry.includes("sonnet")) return true;
      if (alias.family === "haiku" && entry.includes("haiku")) return true;
      if (alias.family === "fable" && entry.includes("fable")) return true;
    }
    return false;
  });
}

async function buildClaudeCapabilities(startupError?: string): Promise<AgentCapabilities> {
  let projectDirs: string[] = [];
  try {
    projectDirs = [getStoriesDir(), getRunsDir(), path.dirname(getStoriesDir())];
  } catch {
    // paths not initialized yet — user settings only
  }

  const availableModels = await loadClaudeAvailableModels(projectDirs);
  const models = CLAUDE_PRIMARY_ALIASES.filter((alias) =>
    isClaudeAliasAllowed(alias, availableModels),
  ).map((alias) => ({ value: alias.value, label: alias.label }));

  const resolvedModels =
    models.length > 0 ? models : [...CLAUDE_FALLBACK_MODELS];

  const defaultModel = resolvedModels.some((m) => m.value === "sonnet")
    ? "sonnet"
    : (resolvedModels[0]?.value ?? "sonnet");

  return {
    provider: "claude-code",
    models: resolvedModels,
    effortsByModel: effortsForAllModels(resolvedModels, CLAUDE_EFFORTS),
    defaultModel,
    defaultEffort: "medium",
    source: availableModels.length > 0 ? "claude-settings" : "claude-static",
    error: startupError,
  };
}

function codexFallbackCapabilities(error?: string): AgentCapabilities {
  return {
    provider: "codex",
    models: CODEX_FALLBACK_MODELS,
    effortsByModel: effortsForAllModels(CODEX_FALLBACK_MODELS, CODEX_FALLBACK_EFFORTS),
    defaultModel: "gpt-5.5",
    defaultEffort: "medium",
    source: "fallback",
    error,
  };
}

async function fetchCodexCapabilities(codexBinary: string): Promise<AgentCapabilities> {
  try {
    const { stdout } = await execFileAsync(codexBinary, ["debug", "models"], {
      timeout: 15_000,
      maxBuffer: 1024 * 1024 * 4,
    });
    const parsed = JSON.parse(stdout) as { models?: CodexCatalogModel[] };
    const catalog = (parsed.models ?? []).filter((m) => m.visibility === "list");
    if (catalog.length === 0) {
      return codexFallbackCapabilities("Codex model catalog was empty");
    }

    const models = catalog.map((m) => ({
      value: m.slug,
      label: m.display_name || m.slug,
    }));
    const effortsByModel: Record<string, string[]> = {};
    for (const m of catalog) {
      const efforts = (m.supported_reasoning_levels ?? []).map((e) => e.effort);
      effortsByModel[m.slug] =
        efforts.length > 0 ? efforts : [...CODEX_FALLBACK_EFFORTS];
    }

    const defaultEntry =
      catalog.find((m) => m.slug === "gpt-5.5") ?? catalog[0]!;
    const defaultEfforts = effortsByModel[defaultEntry.slug] ?? [...CODEX_FALLBACK_EFFORTS];

    return {
      provider: "codex",
      models,
      effortsByModel,
      defaultModel: defaultEntry.slug,
      defaultEffort:
        defaultEntry.default_reasoning_level &&
        defaultEfforts.includes(defaultEntry.default_reasoning_level)
          ? defaultEntry.default_reasoning_level
          : defaultEfforts.includes("medium")
            ? "medium"
            : (defaultEfforts[0] ?? "medium"),
      source: "codex-catalog",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return codexFallbackCapabilities(message);
  }
}

async function loadCodexCapabilities(
  codexBinaryPath: string | null,
  claudeBinaryPath: string | null,
): Promise<AgentCapabilities> {
  try {
    const codexBinary = await resolveAgentBinary("codex", codexBinaryPath, claudeBinaryPath);
    return fetchCodexCapabilities(codexBinary);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return codexFallbackCapabilities(message);
  }
}

async function loadClaudeCapabilities(
  codexBinaryPath: string | null,
  claudeBinaryPath: string | null,
): Promise<AgentCapabilities> {
  try {
    await resolveAgentBinary("claude-code", codexBinaryPath, claudeBinaryPath);
    return buildClaudeCapabilities();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return buildClaudeCapabilities(message);
  }
}

/** Load model catalogs once per app session (at startup, non-blocking). */
export function warmAgentCapabilitiesCache(
  codexBinaryPath: string | null,
  claudeBinaryPath: string | null,
): void {
  if (_warmed) return;

  void (async () => {
    const [codex, claude] = await Promise.all([
      loadCodexCapabilities(codexBinaryPath, claudeBinaryPath),
      loadClaudeCapabilities(codexBinaryPath, claudeBinaryPath),
    ]);
    _cache = { codex, "claude-code": claude };
    _warmed = true;
  })();
}

export function getCachedAgentCapabilities(provider: AgentProvider): AgentCapabilities {
  if (provider === "claude-code") {
    return (
      _cache["claude-code"] ??
      ({
        provider: "claude-code",
        models: CLAUDE_FALLBACK_MODELS,
        effortsByModel: effortsForAllModels(CLAUDE_FALLBACK_MODELS, CLAUDE_EFFORTS),
        defaultModel: "sonnet",
        defaultEffort: "medium",
        source: "claude-static",
      } satisfies AgentCapabilities)
    );
  }

  return _cache.codex ?? codexFallbackCapabilities();
}

export function getAllCachedAgentCapabilities(): AgentCapabilitiesSnapshot {
  return {
    codex: getCachedAgentCapabilities("codex"),
    claude: getCachedAgentCapabilities("claude-code"),
  };
}

/** Whether the real model catalogs have finished loading (vs. still using fallbacks). */
export function isAgentCapabilitiesWarmed(): boolean {
  return _warmed;
}

export function normalizeAgentModelSettings(
  settings: {
    codexModel: string;
    codexEffort: string;
    claudeModel: string;
    claudeEffort: string;
  },
): {
  codexModel: string;
  codexEffort: string;
  claudeModel: string;
  claudeEffort: string;
} {
  // Capabilities haven't loaded yet — only the tiny fallback list is known, so
  // validating against it now would wrongly reset a saved model/effort that's
  // actually valid but just not in the fallback list. Trust the saved values
  // until the real catalog is available.
  if (!_warmed) {
    return { ...settings };
  }

  const codex = getCachedAgentCapabilities("codex");
  const claude = getCachedAgentCapabilities("claude-code");

  const codexModel = codex.models.some((m) => m.value === settings.codexModel)
    ? settings.codexModel
    : codex.defaultModel;
  const codexEfforts = codex.effortsByModel[codexModel] ?? codex.effortsByModel[codex.defaultModel] ?? [];
  const codexEffort = codexEfforts.includes(settings.codexEffort)
    ? settings.codexEffort
    : codex.defaultEffort;

  const claudeModel = claude.models.some((m) => m.value === settings.claudeModel)
    ? settings.claudeModel
    : claude.defaultModel;
  const claudeEfforts = claude.effortsByModel[claudeModel] ?? claude.effortsByModel[claude.defaultModel] ?? [];
  const claudeEffort = claudeEfforts.includes(settings.claudeEffort)
    ? settings.claudeEffort
    : claude.defaultEffort;

  return { codexModel, codexEffort, claudeModel, claudeEffort };
}

export function isModelAllowed(provider: AgentProvider, model: unknown): model is string {
  if (typeof model !== "string" || model.length === 0) return false;
  const caps = getCachedAgentCapabilities(provider);
  return caps.models.some((m) => m.value === model);
}

export function isEffortAllowed(
  provider: AgentProvider,
  model: string,
  effort: unknown,
): effort is string {
  if (typeof effort !== "string" || effort.length === 0) return false;
  const caps = getCachedAgentCapabilities(provider);
  const efforts = caps.effortsByModel[model] ?? caps.effortsByModel[caps.defaultModel] ?? [];
  return efforts.includes(effort);
}
