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
  toast,
} from "@/components/ui";
import { settingsGet, settingsSet, storiesImport, closeSettings } from "../lib/ipc";
import type { AppSettings } from "../lib/contract-types";
import { FolderOpenIcon, Loader2Icon } from "lucide-react";

/** Standalone settings window (legacy). Main app uses `main/settings-view.tsx`. */
export function SettingsWindowView() {
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [startingUrl, setStartingUrl] = useState<string>("");
  const [runHook, setRunHook] = useState<string>("");
  const [isImporting, setIsImporting] = useState(false);

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
    const theme = value === "light" ? "light" : "dark";
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

  return (
    <ScrollArea
      className="h-full min-h-0"
      toolbar={
        <Toolbar titlebar surface="main">
          <ToolbarRow className="h-auto">
            <ToolbarContent className="titlebar-toolbar-content">
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

            <Field label="Import stories">
              <Button
                variant="filled"
                size="medium"
                onClick={handleImport}
                disabled={isImporting}
              >
                {isImporting ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : (
                  <FolderOpenIcon className="size-4" />
                )}
                {isImporting ? "Importing…" : "Select files"}
              </Button>
            </Field>
          </FieldGroup>
        </FieldSet>
      </div>
    </ScrollArea>
  );
}
