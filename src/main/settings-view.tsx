import { useState, useEffect } from "react";
import {
  ScrollArea,
  Toolbar,
  ToolbarRow,
  Input,
  Textarea,
  Button,
  toast,
  Switch,
} from "@/components/ui";
import { settingsGet, settingsSet, storiesImport, storiesExport } from "../lib/ipc";
import type { AppSettings, AgentCapabilities } from "../lib/contract-types";
import { useAgentCapabilities } from "../lib/agent-capabilities-store";
import { FolderDownIcon, FolderOpenIcon, Loader2Icon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SETTINGS_SECTION_LABELS,
} from "../components/settings-sections";
import { ProviderSegment } from "../components/provider-segment";
import { LabeledSegment } from "../components/labeled-segment";
import type {
  AgentProvider,
  ThemePreference,
  ColorThemeId,
  CodexModel,
  CodexEffort,
  ClaudeModel,
  ClaudeEffort,
} from "../lib/contract-types";
import {
  getEffortSegmentOptions,
  getModelSegmentOptions,
  effortSegmentClass,
  modelSegmentClass,
} from "../lib/agent-config";
import { applyAppearance, activeColorThemeForMode, resolveTheme } from "../lib/theme";
import { ColorThemePicker } from "../components/color-theme-picker";
import {
  applyImportedColorTheme,
  appearancePatchForMode,
  exportColorThemeConfig,
  parseImportedColorTheme,
  resolveEffectiveContrast,
  resolveEffectivePalette,
} from "../lib/color-theme-config";
import type { ColorThemePalette } from "../lib/color-themes";
import {
  ThemeColorField,
  ThemeContrastField,
} from "../components/theme-color-field";
import { normalizeAppSettings } from "../lib/app-settings";
import { reportAppError, reportAppErrorFromUnknown } from "@/lib/app-error";
import { useSettingsSection } from "@/lib/use-settings-section";
import {
  getCachedAppSettings,
  setCachedAppSettings,
} from "../lib/settings-cache";

function ThemeSegment({
  value,
  onChange,
}: {
  value: ThemePreference;
  onChange: (value: ThemePreference) => void;
}) {
  return (
    <LabeledSegment
      value={value}
      options={[
        { value: "system", label: "System" },
        { value: "light", label: "Light" },
        { value: "dark", label: "Dark" },
      ]}
      segmentClass="segment-control--labeled segment-control--three"
      ariaLabel="Theme"
      onChange={onChange}
    />
  );
}

function SettingsRow({
  label,
  description,
  children,
  stacked,
  className,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
  stacked?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "settings-row",
        stacked && "settings-row--stacked",
        className,
      )}
    >
      <div className="settings-row-copy">
        <div className="settings-row-label">{label}</div>
        {description ? (
          <p className="settings-row-desc">{description}</p>
        ) : null}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
}

function SettingsGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="settings-group">
      <div className="settings-group-body">{children}</div>
    </div>
  );
}

function AgentPanel({
  provider,
  codexModel,
  codexEffort,
  claudeModel,
  claudeEffort,
  capabilities,
  capabilitiesError,
  onProviderChange,
  onCodexModelChange,
  onCodexEffortChange,
  onClaudeModelChange,
  onClaudeEffortChange,
}: {
  provider: AgentProvider;
  codexModel: CodexModel;
  codexEffort: CodexEffort;
  claudeModel: ClaudeModel;
  claudeEffort: ClaudeEffort;
  capabilities: AgentCapabilities | null;
  capabilitiesError?: string;
  onProviderChange: (provider: AgentProvider) => void;
  onCodexModelChange: (model: CodexModel) => void;
  onCodexEffortChange: (effort: CodexEffort) => void;
  onClaudeModelChange: (model: ClaudeModel) => void;
  onClaudeEffortChange: (effort: ClaudeEffort) => void;
}) {
  const model =
    provider === "claude-code" ? claudeModel : codexModel;
  const effort =
    provider === "claude-code" ? claudeEffort : codexEffort;
  const modelOptions = getModelSegmentOptions(provider, capabilities);
  const effortOptions = getEffortSegmentOptions(provider, model, capabilities);
  const modelDescription =
    provider === "claude-code"
      ? "Claude model used when running stories."
      : capabilities?.source === "codex-catalog"
        ? "Codex model used when running stories."
        : "Codex model used when running stories.";

  return (
    <div className="settings-panel">
      <SettingsGroup>
        <SettingsRow
          label="Provider"
          description="Choose which coding agent runs your stories."
        >
          <ProviderSegment value={provider} onChange={onProviderChange} />
        </SettingsRow>

        <SettingsRow
          label="Model"
          description={modelDescription}
        >
          <LabeledSegment
            value={model}
            options={modelOptions}
            segmentClass={modelSegmentClass(provider, capabilities)}
            ariaLabel="Model"
            onChange={(next) => {
              if (provider === "claude-code") {
                onClaudeModelChange(next as ClaudeModel);
              } else {
                onCodexModelChange(next as CodexModel);
              }
            }}
          />
        </SettingsRow>

        <SettingsRow
          label="Effort"
          description={
            provider === "claude-code"
              ? "Reasoning effort for Claude Code runs."
              : "Reasoning effort for Codex runs."
          }
        >
          <LabeledSegment
            value={effort}
            options={effortOptions}
            segmentClass={effortSegmentClass(provider, model, capabilities)}
            ariaLabel="Effort"
            onChange={(next) => {
              if (provider === "claude-code") {
                onClaudeEffortChange(next as ClaudeEffort);
              } else {
                onCodexEffortChange(next as CodexEffort);
              }
            }}
          />
        </SettingsRow>

        {capabilitiesError ? (
          <p className="settings-row-desc px-4 pb-3 text-[var(--color-text-secondary)]">
            Model list loaded at startup with issues; showing fallback options. {capabilitiesError}
          </p>
        ) : null}
      </SettingsGroup>
    </div>
  );
}

function AppearancePanel({
  settings,
  onThemeChange,
  onPointerCursorsChange,
  onColorThemeChange,
  onPaletteChange,
  onContrastChange,
  onCopyTheme,
  onImportTheme,
}: {
  settings: AppSettings;
  onThemeChange: (theme: ThemePreference) => void;
  onPointerCursorsChange: (enabled: boolean) => void;
  onColorThemeChange: (colorTheme: ColorThemeId) => void;
  onPaletteChange: (key: keyof ColorThemePalette, color: string) => void;
  onContrastChange: (contrast: number) => void;
  onCopyTheme: () => void;
  onImportTheme: () => void;
}) {
  const resolvedMode = resolveTheme(settings.theme);
  const colorTheme = activeColorThemeForMode(resolvedMode, settings);
  const palette = resolveEffectivePalette(settings, resolvedMode);
  const contrast = resolveEffectiveContrast(settings, resolvedMode);
  const modeLabel = resolvedMode === "light" ? "Light theme" : "Dark theme";

  return (
    <div className="settings-panel">
      <SettingsGroup>
        <SettingsRow
          label="Theme"
          description="Match your system appearance or choose light or dark."
        >
          <ThemeSegment value={settings.theme} onChange={onThemeChange} />
        </SettingsRow>
        <div className="color-theme-section">
          <div className="color-theme-section-header">
            <div className="color-theme-section-title">{modeLabel}</div>
            <div className="color-theme-section-actions">
              <button
                type="button"
                className="color-theme-action"
                onClick={onImportTheme}
              >
                Import
              </button>
              <button
                type="button"
                className="color-theme-action"
                onClick={onCopyTheme}
              >
                Copy
              </button>
              <ColorThemePicker
                value={colorTheme}
                mode={resolvedMode}
                onChange={onColorThemeChange}
              />
            </div>
          </div>
          <div className="color-theme-customization">
            <ThemeColorField
              label="Accent"
              value={palette.accent}
              onChange={(color) => onPaletteChange("accent", color)}
            />
            <ThemeColorField
              label="Background"
              value={palette.surface}
              onChange={(color) => onPaletteChange("surface", color)}
            />
            <ThemeColorField
              label="Foreground"
              value={palette.ink}
              onChange={(color) => onPaletteChange("ink", color)}
            />
            <ThemeContrastField
              value={contrast}
              accent={palette.accent}
              onChange={onContrastChange}
            />
          </div>
        </div>
        <SettingsRow
          label="Use pointer cursors"
          description="Change the cursor to a pointer when hovering over interactive elements."
        >
          <Switch
            checked={settings.usePointerCursors}
            aria-label="Use pointer cursors"
            onCheckedChange={onPointerCursorsChange}
          />
        </SettingsRow>
      </SettingsGroup>
    </div>
  );
}

function RecordingPanel({
  startingUrl,
  runHook,
  onStartingUrlChange,
  onRunHookChange,
  onSaveStartingUrl,
  onSaveHook,
}: {
  startingUrl: string;
  runHook: string;
  onStartingUrlChange: (value: string) => void;
  onRunHookChange: (value: string) => void;
  onSaveStartingUrl: () => void;
  onSaveHook: () => void;
}) {
  return (
    <div className="settings-panel">
      <SettingsGroup>
        <SettingsRow
          label="Starting URL"
          description="Pre-filled as the Start URL when you record a new story."
          stacked
        >
          <Input
            className="settings-input"
            placeholder="https://…"
            value={startingUrl}
            onChange={(e) => onStartingUrlChange(e.target.value)}
            onBlur={onSaveStartingUrl}
          />
        </SettingsRow>

        <SettingsRow
          label="Hook"
          description="Added to the end of the prompt sent to the agent when starting a run."
          stacked
        >
          <Textarea
            className="settings-textarea"
            placeholder="e.g. Treat any console error as a failure."
            value={runHook}
            rows={3}
            onChange={(e) => onRunHookChange(e.target.value)}
            onBlur={onSaveHook}
          />
        </SettingsRow>
      </SettingsGroup>
    </div>
  );
}

function DataPanel({
  isImporting,
  isExporting,
  onImport,
  onExport,
}: {
  isImporting: boolean;
  isExporting: boolean;
  onImport: () => void;
  onExport: () => void;
}) {
  return (
    <div className="settings-panel">
      <SettingsGroup>
        <SettingsRow
          label="Import stories"
          description="Import .yaml files from your computer."
        >
          <Button
            variant="filled"
            size="small"
            radius="full"
            onClick={onImport}
            disabled={isImporting || isExporting}
          >
            {isImporting ? (
              <Loader2Icon className="size-3.5 animate-spin" />
            ) : (
              <FolderOpenIcon className="size-3.5" />
            )}
            {isImporting ? "Importing…" : "Select files"}
          </Button>
        </SettingsRow>
        <SettingsRow
          label="Export stories"
          description="Copy all .yaml files to a folder on your computer."
        >
          <Button
            variant="filled"
            size="small"
            radius="full"
            onClick={onExport}
            disabled={isImporting || isExporting}
          >
            {isExporting ? (
              <Loader2Icon className="size-3.5 animate-spin" />
            ) : (
              <FolderDownIcon className="size-3.5" />
            )}
            {isExporting ? "Exporting…" : "Choose folder"}
          </Button>
        </SettingsRow>
      </SettingsGroup>
    </div>
  );
}

export function SettingsView() {
  const activeSection = useSettingsSection();

  const [appSettings, setAppSettings] = useState<AppSettings | null>(() =>
    getCachedAppSettings(),
  );
  const [startingUrl, setStartingUrl] = useState<string>("");
  const [runHook, setRunHook] = useState<string>("");
  const [isImporting, setIsImporting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  const resolvedSettings = normalizeAppSettings(appSettings);
  const agentProvider = resolvedSettings.agentProvider;
  const agentCapabilities = useAgentCapabilities(agentProvider);
  const capabilitiesError = agentCapabilities?.error;

  const commitAppSettings = (settings: AppSettings) => {
    const normalized = setCachedAppSettings(settings);
    setAppSettings(normalized);
    return normalized;
  };

  const refreshAppSettings = async () => {
    try {
      const s = commitAppSettings(await settingsGet());
      setStartingUrl(s.startingUrl ?? "");
      setRunHook(s.runHook ?? "");
      setSettingsError(null);
    } catch (error) {
      setSettingsError(String(error));
    }
  };

  useEffect(() => {
    void refreshAppSettings();
  }, []);

  const handleProviderChange = async (agentProvider: AgentProvider) => {
    if (agentProvider === appSettings?.agentProvider) return;
    setAppSettings((prev) => (prev ? { ...prev, agentProvider } : prev));
    try {
      const updated = await settingsSet({ agentProvider });
      commitAppSettings(updated);
    } catch (error) {
      void refreshAppSettings();
      reportAppErrorFromUnknown("Failed to set provider", error);
    }
  };

  const handleCodexModelChange = async (codexModel: CodexModel) => {
    if (codexModel === appSettings?.codexModel) return;
    setAppSettings((prev) => (prev ? { ...prev, codexModel } : prev));
    try {
      const patch: Partial<AppSettings> = { codexModel };
      const efforts =
        agentCapabilities?.provider === "codex"
          ? agentCapabilities.effortsByModel[codexModel]
          : undefined;
      if (efforts && appSettings && !efforts.includes(appSettings.codexEffort)) {
        patch.codexEffort = efforts.includes("medium") ? "medium" : efforts[0];
      }
      const updated = await settingsSet(patch);
      commitAppSettings(updated);
    } catch (error) {
      void refreshAppSettings();
      reportAppErrorFromUnknown("Failed to set model", error);
    }
  };

  const handleCodexEffortChange = async (codexEffort: CodexEffort) => {
    if (codexEffort === appSettings?.codexEffort) return;
    setAppSettings((prev) => (prev ? { ...prev, codexEffort } : prev));
    try {
      const updated = await settingsSet({ codexEffort });
      setAppSettings({ ...updated });
    } catch (error) {
      void refreshAppSettings();
      reportAppErrorFromUnknown("Failed to set effort", error);
    }
  };

  const handleClaudeModelChange = async (claudeModel: ClaudeModel) => {
    if (claudeModel === appSettings?.claudeModel) return;
    setAppSettings((prev) => (prev ? { ...prev, claudeModel } : prev));
    try {
      const updated = await settingsSet({ claudeModel });
      setAppSettings({ ...updated });
    } catch (error) {
      void refreshAppSettings();
      reportAppErrorFromUnknown("Failed to set model", error);
    }
  };

  const handleClaudeEffortChange = async (claudeEffort: ClaudeEffort) => {
    if (claudeEffort === appSettings?.claudeEffort) return;
    setAppSettings((prev) => (prev ? { ...prev, claudeEffort } : prev));
    try {
      const updated = await settingsSet({ claudeEffort });
      setAppSettings({ ...updated });
    } catch (error) {
      void refreshAppSettings();
      reportAppErrorFromUnknown("Failed to set effort", error);
    }
  };

  const handleThemeChange = async (theme: ThemePreference) => {
    const nextSettings = normalizeAppSettings({ ...resolvedSettings, theme });
    commitAppSettings(nextSettings);
    applyAppearance(theme, nextSettings);
    try {
      commitAppSettings(await settingsSet({ theme }));
    } catch (error) {
      void refreshAppSettings();
      reportAppErrorFromUnknown("Failed to set theme", error);
    }
  };

  const handlePointerCursorsChange = async (usePointerCursors: boolean) => {
    if (usePointerCursors === resolvedSettings.usePointerCursors) return;

    const nextSettings = normalizeAppSettings({
      ...resolvedSettings,
      usePointerCursors,
    });
    commitAppSettings(nextSettings);
    applyAppearance(resolvedSettings.theme, nextSettings);
    try {
      commitAppSettings(await settingsSet({ usePointerCursors }));
    } catch (error) {
      void refreshAppSettings();
      reportAppErrorFromUnknown("Failed to set pointer cursors", error);
    }
  };

  const handleColorThemeChange = async (colorTheme: ColorThemeId) => {
    const resolvedMode = resolveTheme(resolvedSettings.theme);
    const currentColorTheme = activeColorThemeForMode(resolvedMode, resolvedSettings);
    if (colorTheme === currentColorTheme) return;

    const patch =
      resolvedMode === "light"
        ? { colorThemeLight: colorTheme, colorThemePaletteLight: null }
        : { colorThemeDark: colorTheme, colorThemePaletteDark: null };
    const nextSettings = normalizeAppSettings({
      ...resolvedSettings,
      ...patch,
    });

    commitAppSettings(nextSettings);
    applyAppearance(resolvedSettings.theme, nextSettings);
    try {
      commitAppSettings(await settingsSet(patch));
    } catch (error) {
      void refreshAppSettings();
      reportAppErrorFromUnknown("Failed to set color theme", error);
    }
  };

  const handlePaletteChange = async (
    key: keyof ColorThemePalette,
    color: string,
  ) => {
    const mode = resolveTheme(resolvedSettings.theme);
    const current = resolveEffectivePalette(resolvedSettings, mode);
    if (current[key] === color) return;

    const palette = { ...current, [key]: color };
    const patch = appearancePatchForMode(mode, { palette });
    const nextSettings = normalizeAppSettings({
      ...resolvedSettings,
      ...patch,
    });

    commitAppSettings(nextSettings);
    applyAppearance(resolvedSettings.theme, nextSettings);
    try {
      commitAppSettings(await settingsSet(patch));
    } catch (error) {
      void refreshAppSettings();
      reportAppErrorFromUnknown("Failed to save color", error);
    }
  };

  const handleContrastChange = async (contrast: number) => {
    const mode = resolveTheme(resolvedSettings.theme);
    const current = resolveEffectiveContrast(resolvedSettings, mode);
    if (contrast === current) return;

    const patch = appearancePatchForMode(mode, { contrast });
    const nextSettings = normalizeAppSettings({
      ...resolvedSettings,
      ...patch,
    });

    commitAppSettings(nextSettings);
    applyAppearance(resolvedSettings.theme, nextSettings);
    try {
      commitAppSettings(await settingsSet(patch));
    } catch (error) {
      void refreshAppSettings();
      reportAppErrorFromUnknown("Failed to save contrast", error);
    }
  };

  const handleCopyTheme = async () => {
    const mode = resolveTheme(resolvedSettings.theme);
    try {
      await navigator.clipboard.writeText(
        exportColorThemeConfig(resolvedSettings, mode),
      );
      toast.success("Theme copied to clipboard.");
    } catch (error) {
      reportAppErrorFromUnknown("Failed to copy theme", error);
    }
  };

  const handleImportTheme = async () => {
    try {
      const raw = await navigator.clipboard.readText();
      const imported = parseImportedColorTheme(raw);
      if (!imported) {
        reportAppError("Clipboard does not contain a valid Codex theme.");
        return;
      }

      const nextSettings = applyImportedColorTheme(resolvedSettings, imported);
      const patch = appearancePatchForMode(imported.variant, {
        preset:
          imported.variant === "light"
            ? nextSettings.colorThemeLight
            : nextSettings.colorThemeDark,
        palette:
          imported.variant === "light"
            ? nextSettings.colorThemePaletteLight
            : nextSettings.colorThemePaletteDark,
        contrast:
          imported.variant === "light"
            ? nextSettings.colorThemeContrastLight
            : nextSettings.colorThemeContrastDark,
      });

      commitAppSettings(nextSettings);
      applyAppearance(resolvedSettings.theme, nextSettings);
      commitAppSettings(await settingsSet(patch));
      toast.success(
        `Imported ${imported.variant === "light" ? "light" : "dark"} theme.`,
      );
    } catch (error) {
      reportAppErrorFromUnknown("Failed to import theme", error);
    }
  };

  const handleSaveStartingUrl = async () => {
    const next = startingUrl.trim();
    if (next === (appSettings?.startingUrl ?? "")) return;
    try {
      const updated = await settingsSet({ startingUrl: next });
      setAppSettings(updated);
    } catch (err) {
      reportAppErrorFromUnknown("Failed to save", err);
    }
  };

  const handleSaveHook = async () => {
    if (runHook === (appSettings?.runHook ?? "")) return;
    try {
      const updated = await settingsSet({ runHook });
      setAppSettings(updated);
    } catch (err) {
      reportAppErrorFromUnknown("Failed to save", err);
    }
  };

  useEffect(() => {
    if (appSettings === null) return;
    if (startingUrl.trim() === (appSettings.startingUrl ?? "")) return;
    const t = setTimeout(() => void handleSaveStartingUrl(), 600);
    return () => clearTimeout(t);
  }, [startingUrl, appSettings]);

  useEffect(() => {
    if (appSettings === null) return;
    if (runHook === (appSettings.runHook ?? "")) return;
    const t = setTimeout(() => void handleSaveHook(), 600);
    return () => clearTimeout(t);
  }, [runHook, appSettings]);

  const handleImport = async () => {
    setIsImporting(true);
    try {
      const imported = await storiesImport();
      toast.success(
        imported.length === 1
          ? "Imported 1 story."
          : `Imported ${imported.length} stories.`,
      );
    } catch (err) {
      reportAppErrorFromUnknown("Import failed", err);
    } finally {
      setIsImporting(false);
    }
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const result = await storiesExport();
      if (result.canceled) return;
      if (result.fileCount === 0) {
        reportAppError("No .yaml files to export.");
        return;
      }
      toast.success(
        result.fileCount === 1
          ? "Exported 1 .yaml file."
          : `Exported ${result.fileCount} .yaml files.`,
      );
    } catch (err) {
      reportAppErrorFromUnknown("Export failed", err);
    } finally {
      setIsExporting(false);
    }
  };

  const pageTitle = SETTINGS_SECTION_LABELS[activeSection];

  return (
    <ScrollArea
      className="h-full min-h-0"
      toolbar={
        <Toolbar titlebar surface="main" seamless>
          <ToolbarRow inset="main" className="main-titlebar-row" />
        </Toolbar>
      }
    >
      <div className="settings-page">
        <div className="settings-page-inner">
          <h1 className="settings-page-title">{pageTitle}</h1>

          {activeSection === "appearance" ? (
            <AppearancePanel
              settings={resolvedSettings}
              onThemeChange={handleThemeChange}
              onPointerCursorsChange={handlePointerCursorsChange}
              onColorThemeChange={handleColorThemeChange}
              onPaletteChange={handlePaletteChange}
              onContrastChange={handleContrastChange}
              onCopyTheme={handleCopyTheme}
              onImportTheme={handleImportTheme}
            />
          ) : null}

          {activeSection === "agent" ? (
            <AgentPanel
              provider={resolvedSettings.agentProvider}
              codexModel={resolvedSettings.codexModel}
              codexEffort={resolvedSettings.codexEffort}
              claudeModel={resolvedSettings.claudeModel}
              claudeEffort={resolvedSettings.claudeEffort}
              capabilities={agentCapabilities}
              capabilitiesError={capabilitiesError ?? settingsError ?? undefined}
              onProviderChange={handleProviderChange}
              onCodexModelChange={handleCodexModelChange}
              onCodexEffortChange={handleCodexEffortChange}
              onClaudeModelChange={handleClaudeModelChange}
              onClaudeEffortChange={handleClaudeEffortChange}
            />
          ) : null}

          {activeSection === "recording" ? (
            <RecordingPanel
              startingUrl={startingUrl}
              runHook={runHook}
              onStartingUrlChange={setStartingUrl}
              onRunHookChange={setRunHook}
              onSaveStartingUrl={handleSaveStartingUrl}
              onSaveHook={handleSaveHook}
            />
          ) : null}

          {activeSection === "data" ? (
            <DataPanel
              isImporting={isImporting}
              isExporting={isExporting}
              onImport={handleImport}
              onExport={handleExport}
            />
          ) : null}
        </div>
      </div>
    </ScrollArea>
  );
}
