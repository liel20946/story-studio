import * as React from "react";
import type { AgentModelOverride, AgentProvider } from "./contract-types";
import {
  getDefaultChatModelSelection,
  getEffortOptions,
  getModelOptions,
  formatAgentModelLabel,
  formatEffortLabel,
  type AgentCapabilities,
} from "./agent-config";
import { getCachedAppSettings } from "./settings-cache";
import { normalizeAppSettings } from "./app-settings";
import { settingsGet } from "./ipc";

const STORAGE_KEY = "story-studio:generate-chat-model";

function readStoredOverride(): AgentModelOverride | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AgentModelOverride>;
    if (typeof parsed.model !== "string" || typeof parsed.effort !== "string") return null;
    return { model: parsed.model, effort: parsed.effort };
  } catch {
    return null;
  }
}

function writeStoredOverride(override: AgentModelOverride | null): void {
  try {
    if (!override) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(override));
  } catch {
    // ignore quota / private mode
  }
}

function optionKey(option: AgentModelOverride): string {
  return `${option.model}::${option.effort}`;
}

function findMatchingSelection(
  provider: AgentProvider,
  capabilities: AgentCapabilities | null,
  selection: AgentModelOverride,
): AgentModelOverride {
  const models = getModelOptions(provider, capabilities);
  const model =
    models.find((m) => m.value === selection.model)?.value ?? models[0]?.value ?? selection.model;
  const efforts = getEffortOptions(provider, model, capabilities);
  const effort = efforts.includes(selection.effort)
    ? selection.effort
    : (efforts.includes("medium") ? "medium" : efforts[0] ?? selection.effort);
  return { model, effort };
}

export function useChatModelSelection(capabilities: AgentCapabilities | null) {
  const [settings, setSettings] = React.useState(() =>
    normalizeAppSettings(getCachedAppSettings()),
  );

  React.useEffect(() => {
    void settingsGet()
      .then((next) => setSettings(normalizeAppSettings(next)))
      .catch(() => {
        // keep cached/default settings
      });
  }, []);

  React.useEffect(() => {
    const syncFromCache = () => {
      const cached = getCachedAppSettings();
      if (cached) setSettings(normalizeAppSettings(cached));
    };
    window.addEventListener("story-studio:settings-changed", syncFromCache);
    return () => window.removeEventListener("story-studio:settings-changed", syncFromCache);
  }, []);

  const provider = settings.agentProvider;
  const models = React.useMemo(
    () => getModelOptions(provider, capabilities),
    [provider, capabilities],
  );
  const settingsDefault = React.useMemo(
    () => getDefaultChatModelSelection(provider, settings),
    [provider, settings],
  );

  const [selection, setSelection] = React.useState<AgentModelOverride>(() => {
    const stored = readStoredOverride();
    const base = stored ?? settingsDefault;
    return findMatchingSelection(provider, capabilities, base);
  });

  React.useEffect(() => {
    setSelection((prev) => {
      const stored = readStoredOverride();
      const base = stored ?? settingsDefault;
      const next = findMatchingSelection(provider, capabilities, stored ? base : prev);
      return optionKey(next) === optionKey(prev) ? prev : next;
    });
  }, [provider, capabilities, settingsDefault]);

  const efforts = React.useMemo(
    () => getEffortOptions(provider, selection.model, capabilities),
    [provider, selection.model, capabilities],
  );

  const setChatModelSelection = React.useCallback(
    (next: AgentModelOverride) => {
      const resolved = findMatchingSelection(provider, capabilities, next);
      writeStoredOverride(resolved);
      setSelection(resolved);
    },
    [provider, capabilities],
  );

  const resetToSettingsDefault = React.useCallback(() => {
    writeStoredOverride(null);
    setSelection(findMatchingSelection(provider, capabilities, settingsDefault));
  }, [provider, capabilities, settingsDefault]);

  const modelLabel = formatAgentModelLabel(provider, selection.model, capabilities);
  const effortLabel = formatEffortLabel(selection.effort);

  const isOverridden =
    selection.model !== settingsDefault.model || selection.effort !== settingsDefault.effort;

  return {
    provider,
    models,
    efforts,
    selection,
    modelLabel,
    effortLabel,
    isOverridden,
    setChatModelSelection,
    resetToSettingsDefault,
  };
}

export function formatAgentCliLabel(provider: AgentProvider): string {
  return provider === "claude-code" ? "Claude Code" : "Codex";
}
