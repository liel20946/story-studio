import { useState, useEffect, useCallback } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  ScrollArea,
  Toolbar,
  ToolbarRow,
  Input,
  Textarea,
  Button,
  toast,
} from "@/components/ui";
import { settingsGet, settingsSet, storiesImport } from "../lib/ipc";
import type { AppSettings } from "../lib/contract-types";
import { FolderOpenIcon, Loader2Icon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SETTINGS_SECTION_LABELS,
  type SettingsSection,
} from "../components/settings-sections";

function ThemeSegment({
  value,
  onChange,
}: {
  value: "light" | "dark";
  onChange: (value: "light" | "dark") => void;
}) {
  const options = [
    { value: "light" as const, label: "Light" },
    { value: "dark" as const, label: "Dark" },
  ];

  return (
    <div
      className="segment-control segment-control--labeled shrink-0"
      role="tablist"
      aria-label="Theme"
    >
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            data-active={active}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function SettingsRow({
  label,
  description,
  children,
  className,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("settings-row", className)}>
      <div className="min-w-0 flex-1">
        <div className="text-strong">{label}</div>
        {description ? (
          <p className="mt-0.5 text-small text-tertiary">{description}</p>
        ) : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function SettingsField({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div>
        <div className="text-strong">{label}</div>
        {description ? (
          <p className="mt-0.5 text-small text-tertiary">{description}</p>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function AppearancePanel({
  theme,
  onThemeChange,
}: {
  theme: "light" | "dark";
  onThemeChange: (theme: "light" | "dark") => void;
}) {
  return (
    <div className="settings-panel-open">
      <SettingsRow
        label="Theme"
        description="Use light or dark appearance."
      >
        <ThemeSegment value={theme} onChange={onThemeChange} />
      </SettingsRow>
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
    <div className="settings-panel-open flex flex-col gap-6">
      <div className="codex-section">
        <span className="section-label">Defaults</span>
        <div className="flex flex-col gap-5">
          <SettingsField
            label="Starting URL"
            description="Pre-filled as the Start URL when you record a new story."
          >
            <Input
              placeholder="https://…"
              value={startingUrl}
              onChange={(e) => onStartingUrlChange(e.target.value)}
              onBlur={onSaveStartingUrl}
            />
          </SettingsField>

          <SettingsField
            label="Hook"
            description="Added to the end of the prompt sent to Codex when starting a run."
          >
            <Textarea
              placeholder="e.g. Treat any console error as a failure."
              value={runHook}
              rows={3}
              onChange={(e) => onRunHookChange(e.target.value)}
              onBlur={onSaveHook}
            />
          </SettingsField>
        </div>
      </div>
    </div>
  );
}

function DataPanel({
  isImporting,
  onImport,
}: {
  isImporting: boolean;
  onImport: () => void;
}) {
  return (
    <div className="settings-panel-open">
      <SettingsRow
        label="Import stories"
        description="Import .story files from your computer."
      >
        <Button
          variant="filled"
          size="medium"
          radius="full"
          onClick={onImport}
          disabled={isImporting}
        >
          {isImporting ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            <FolderOpenIcon className="size-4" />
          )}
          {isImporting ? "Importing…" : "Select files"}
        </Button>
      </SettingsRow>
    </div>
  );
}

export function SettingsView() {
  const navigate = useNavigate();
  const { section } = useSearch({ from: "/settings" });
  const activeSection: SettingsSection = section;

  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [startingUrl, setStartingUrl] = useState<string>("");
  const [runHook, setRunHook] = useState<string>("");
  const [isImporting, setIsImporting] = useState(false);

  const handleBack = useCallback(() => {
    navigate({ to: "/" });
  }, [navigate]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (event.defaultPrevented) return;

      const el = document.activeElement;
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement ||
        (el instanceof HTMLElement && el.isContentEditable)
      ) {
        return;
      }

      if (document.querySelector("[data-radix-popper-content-wrapper]")) {
        return;
      }

      event.preventDefault();
      handleBack();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleBack]);

  const refreshAppSettings = async () => {
    try {
      const s = await settingsGet();
      setAppSettings(s);
      setStartingUrl(s.startingUrl ?? "");
      setRunHook(s.runHook ?? "");
    } catch {
      // Settings backend may not be ready yet; silently ignore
    }
  };

  useEffect(() => {
    void refreshAppSettings();
  }, []);

  const handleThemeChange = async (theme: "light" | "dark") => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    try {
      const updated = await settingsSet({ theme });
      setAppSettings(updated);
    } catch (error) {
      toast.error(`Failed to set theme: ${error}`);
    }
  };

  const handleSaveStartingUrl = async () => {
    const next = startingUrl.trim();
    if (next === (appSettings?.startingUrl ?? "")) return;
    try {
      const updated = await settingsSet({ startingUrl: next });
      setAppSettings(updated);
    } catch (err) {
      toast.error(`Failed to save: ${err}`);
    }
  };

  const handleSaveHook = async () => {
    if (runHook === (appSettings?.runHook ?? "")) return;
    try {
      const updated = await settingsSet({ runHook });
      setAppSettings(updated);
    } catch (err) {
      toast.error(`Failed to save: ${err}`);
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
      toast.error(`Import failed: ${err}`);
    } finally {
      setIsImporting(false);
    }
  };

  const pageTitle = SETTINGS_SECTION_LABELS[activeSection];
  const theme = appSettings?.theme === "light" ? "light" : "dark";

  return (
    <ScrollArea
      className="h-full min-h-0"
      toolbar={
        <Toolbar titlebar surface="main" seamless>
          <ToolbarRow inset="main" className="h-11" />
        </Toolbar>
      }
    >
      <div className="settings-page">
        <div className="settings-page-inner">
          <h1 className="settings-page-title">{pageTitle}</h1>

          {activeSection === "appearance" ? (
            <AppearancePanel theme={theme} onThemeChange={handleThemeChange} />
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
            <DataPanel isImporting={isImporting} onImport={handleImport} />
          ) : null}
        </div>
      </div>
    </ScrollArea>
  );
}
