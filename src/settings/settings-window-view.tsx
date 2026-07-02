import { useState, useEffect } from "react";
import {
  Label,
  RadioGroup,
  RadioGroupItem,
  ScrollArea,
  Toolbar,
  ToolbarRow,
  ToolbarContent,
  ToolbarTitle,
  Field,
  FieldGroup,
  FieldSet,
  Input,
  Textarea,
  Button,
} from "@/components/ui";
import { applyTheme } from "../lib/theme";
import {
  settingsGet,
  settingsSet,
  closeSettings,
} from "../lib/ipc";
import { useStoriesDataTransfer } from "../components/stories-data-transfer";
import type { AppSettings, ThemePreference } from "../lib/contract-types";
import { shouldIgnoreEscapeKey } from "../lib/escape-key";
import { reportAppErrorFromUnknown } from "@/lib/app-error";
import { FolderDownIcon, FolderOpenIcon, Loader2Icon } from "lucide-react";

/** Standalone settings window (legacy). Main app uses `main/settings-view.tsx`. */
export function SettingsWindowView() {
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [startingUrl, setStartingUrl] = useState<string>("");
  const [runHook, setRunHook] = useState<string>("");
  const storiesDataTransfer = useStoriesDataTransfer();
  const { isImporting, isExporting } = storiesDataTransfer;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreEscapeKey(event)) return;

      event.preventDefault();
      void closeSettings();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

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

  const handleThemeChange = async (value: string) => {
    const theme: ThemePreference =
      value === "light" ? "light" : value === "system" ? "system" : "dark";
    applyTheme(theme);
    try {
      const updated = await settingsSet({ theme });
      setAppSettings(updated);
    } catch (error) {
      reportAppErrorFromUnknown("Failed to set theme", error);
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

  const handleImport = storiesDataTransfer.startImport;
  const handleExport = storiesDataTransfer.startExport;

  return (
    <ScrollArea
      className="h-full min-h-0"
      toolbar={
        <Toolbar titlebar surface="main">
          <ToolbarRow className="main-titlebar-row">
            <ToolbarContent className="titlebar-toolbar-content detail-view-toolbar-content">
              <ToolbarTitle>Settings</ToolbarTitle>
            </ToolbarContent>
          </ToolbarRow>
        </Toolbar>
      }
    >
      <div className="mb-8 flex max-w-2xl flex-col gap-6 px-4">
        <FieldSet>
          <FieldGroup>
            <Field
              orientation="horizontal"
              label="Theme"
              description="Choose the app appearance."
            >
              <RadioGroup
                value={appSettings?.theme ?? "dark"}
                onValueChange={handleThemeChange}
                orientation="horizontal"
              >
                <Label>
                  <RadioGroupItem value="system" />
                  System
                </Label>
                <Label>
                  <RadioGroupItem value="dark" />
                  Dark
                </Label>
                <Label>
                  <RadioGroupItem value="light" />
                  Light
                </Label>
              </RadioGroup>
            </Field>
          </FieldGroup>
        </FieldSet>

        <FieldSet title="Story Studio">
          <FieldGroup>
            <Field
              label="Starting URL"
              description="Pre-filled as the Start URL when you record a new story."
              orientation="vertical"
            >
              <Input
                placeholder="https://…"
                value={startingUrl}
                onChange={(e) => setStartingUrl(e.target.value)}
                onBlur={handleSaveStartingUrl}
              />
            </Field>

            <Field
              label="Hook"
              description="Added to the end of the prompt sent to Codex when starting a run."
              orientation="vertical"
            >
              <Textarea
                placeholder="e.g. Treat any console error as a failure."
                value={runHook}
                rows={3}
                onChange={(e) => setRunHook(e.target.value)}
                onBlur={handleSaveHook}
              />
            </Field>

            <Field
              label="Import stories"
              description="Import .yaml files from your computer."
            >
              <Button
                variant="filled"
                size="medium"
                onClick={handleImport}
                disabled={isImporting || isExporting}
              >
                {isImporting ? (
                  <Loader2Icon className="size-4 animate-spin text-accent" />
                ) : (
                  <FolderOpenIcon className="size-4" />
                )}
                {isImporting ? "Importing…" : "Select files"}
              </Button>
            </Field>

            <Field
              label="Export stories"
              description="Copy all .yaml files to a folder on your computer."
            >
              <Button
                variant="filled"
                size="medium"
                onClick={handleExport}
                disabled={isImporting || isExporting}
              >
                {isExporting ? (
                  <Loader2Icon className="size-4 animate-spin text-accent" />
                ) : (
                  <FolderDownIcon className="size-4" />
                )}
                {isExporting ? "Exporting…" : "Export…"}
              </Button>
            </Field>
          </FieldGroup>
        </FieldSet>
      </div>
      {storiesDataTransfer.importDialog}
      {storiesDataTransfer.exportDialog}
    </ScrollArea>
  );
}
