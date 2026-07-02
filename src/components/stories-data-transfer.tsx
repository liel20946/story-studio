import { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  RadioGroup,
  RadioGroupItem,
  Text,
  toast,
} from "@/components/ui";
import {
  storiesExport,
  storiesExportPreview,
  storiesImport,
  storiesPickExportFolder,
  storiesPickImportFiles,
  storiesPreviewImport,
} from "@/lib/ipc";
import type { ExportPreview, ImportMode, ImportPreview } from "@/lib/contract-types";
import { reportAppError, reportAppErrorFromUnknown } from "@/lib/app-error";
import { cn } from "@/lib/utils";
import { FolderDownIcon, FolderOpenIcon, Loader2Icon } from "lucide-react";

function formatStoryCount(count: number): string {
  return count === 1 ? "1 story" : `${count} stories`;
}

function formatFileCount(count: number): string {
  return count === 1 ? "1 file" : `${count} files`;
}

function ImportStoriesDialog({
  open,
  preview,
  isImporting,
  onOpenChange,
  onImport,
}: {
  open: boolean;
  preview: ImportPreview | null;
  isImporting: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (mode: ImportMode) => void;
}) {
  const [mode, setMode] = useState<ImportMode>("add");

  useEffect(() => {
    if (open) setMode("add");
  }, [open, preview]);

  if (!preview) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="medium" onEscapeKeyDown={() => !isImporting && onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>Import stories</DialogTitle>
          <DialogDescription>
            Found {formatStoryCount(preview.storyCount)} in{" "}
            {formatFileCount(preview.fileCount)}. Choose how to import them.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <RadioGroup
            value={mode}
            onValueChange={(value) => setMode(value as ImportMode)}
            orientation="vertical"
            className="gap-3"
          >
            <label
              className={cn(
                "flex w-full cursor-pointer items-start gap-3 rounded-card border p-3 transition-colors",
                mode === "add" ? "border-accent bg-accent/5" : "border-separator",
              )}
            >
              <RadioGroupItem value="add" className="mt-0.5 shrink-0" />
              <span className="flex flex-col gap-1">
                <Text variant="regular">Add to library</Text>
                <Text variant="small" color="secondary">
                  Keep your existing stories and add new ones. Stories with the same
                  ID in the same site file are skipped.
                </Text>
              </span>
            </label>
            <label
              className={cn(
                "flex w-full cursor-pointer items-start gap-3 rounded-card border p-3 transition-colors",
                mode === "overwrite" ? "border-accent bg-accent/5" : "border-separator",
              )}
            >
              <RadioGroupItem value="overwrite" className="mt-0.5 shrink-0" />
              <span className="flex flex-col gap-1">
                <Text variant="regular">Overwrite existing data</Text>
                <Text variant="small" color="secondary">
                  Replace site files that match the imported filenames. Other stories
                  are left unchanged.
                </Text>
              </span>
            </label>
          </RadioGroup>
        </DialogBody>
        <DialogFooter>
          <Button variant="filled" onClick={() => onOpenChange(false)} disabled={isImporting}>
            Cancel
          </Button>
          <Button variant="accent" disabled={isImporting} onClick={() => onImport(mode)}>
            {isImporting ? (
              <>
                <Loader2Icon className="size-4 animate-spin" />
                Importing…
              </>
            ) : (
              "Import"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ExportStoriesDialog({
  open,
  preview,
  destDir,
  isExporting,
  isPickingFolder,
  onOpenChange,
  onPickFolder,
  onExport,
}: {
  open: boolean;
  preview: ExportPreview | null;
  destDir: string;
  isExporting: boolean;
  isPickingFolder: boolean;
  onOpenChange: (open: boolean) => void;
  onPickFolder: () => void;
  onExport: () => void;
}) {
  if (!preview) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="medium" onEscapeKeyDown={() => !isExporting && onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>Export stories</DialogTitle>
          <DialogDescription>
            Export {formatStoryCount(preview.storyCount)}
            {preview.fileCount > 0
              ? ` from ${formatFileCount(preview.fileCount)}`
              : ""}
            . Choose where to save them, then export.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Field label="Save location" orientation="vertical">
            <div className="flex flex-col gap-2">
              <Button
                variant="filled"
                onClick={onPickFolder}
                disabled={isExporting || isPickingFolder}
              >
                <FolderOpenIcon className="size-4" />
                Choose folder
              </Button>
              {destDir ? (
                <Text variant="small" color="secondary" className="break-all">
                  {destDir}
                </Text>
              ) : (
                <Text variant="small" color="secondary">
                  No folder selected yet.
                </Text>
              )}
            </div>
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="filled" onClick={() => onOpenChange(false)} disabled={isExporting}>
            Cancel
          </Button>
          <Button
            variant="accent"
            disabled={!destDir || isExporting || isPickingFolder}
            onClick={onExport}
          >
            {isExporting ? (
              <>
                <Loader2Icon className="size-4 animate-spin" />
                Exporting…
              </>
            ) : (
              <>
                <FolderDownIcon className="size-4" />
                Export
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function useStoriesDataTransfer() {
  const [isImporting, setIsImporting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isPickingFolder, setIsPickingFolder] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [exportPreview, setExportPreview] = useState<ExportPreview | null>(null);
  const [importPaths, setImportPaths] = useState<string[]>([]);
  const [exportDestDir, setExportDestDir] = useState("");

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const onDevShow = (event: Event) => {
      const detail = (event as CustomEvent<{
        preview: ImportPreview;
        paths: string[];
      }>).detail;
      if (!detail?.preview || !detail.paths?.length) return;
      setImportPaths(detail.paths);
      setImportPreview(detail.preview);
      setImportDialogOpen(true);
    };
    window.addEventListener("dev:show-import-dialog", onDevShow);
    return () => window.removeEventListener("dev:show-import-dialog", onDevShow);
  }, []);

  const startImport = async () => {
    if (isImporting || isExporting) return;
    setIsImporting(true);
    try {
      const picked = await storiesPickImportFiles();
      if (picked.canceled || picked.paths.length === 0) return;

      const preview = await storiesPreviewImport(picked.paths);
      if (!preview.valid) {
        const message =
          preview.errors.length > 0
            ? preview.errors.slice(0, 3).join("\n")
            : "No valid stories found in the selected files.";
        reportAppError(message);
        return;
      }

      setImportPaths(picked.paths);
      setImportPreview(preview);
      setImportDialogOpen(true);
    } catch (err) {
      reportAppErrorFromUnknown("Import failed", err);
    } finally {
      setIsImporting(false);
    }
  };

  const confirmImport = async (mode: ImportMode) => {
    if (importPaths.length === 0) return;
    setIsImporting(true);
    try {
      const imported = await storiesImport(importPaths, mode);
      setImportDialogOpen(false);
      setImportPreview(null);
      setImportPaths([]);
      if (imported.length === 0) {
        toast.success(
          mode === "add"
            ? "No new stories were added. Existing IDs were skipped."
            : "Import completed.",
        );
        return;
      }
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

  const startExport = async () => {
    if (isImporting || isExporting) return;
    try {
      const preview = await storiesExportPreview();
      if (preview.storyCount === 0) {
        reportAppError("No stories to export.");
        return;
      }
      setExportPreview(preview);
      setExportDestDir("");
      setExportDialogOpen(true);
    } catch (err) {
      reportAppErrorFromUnknown("Export failed", err);
    }
  };
    if (isPickingFolder || isExporting) return;
    setIsPickingFolder(true);
    try {
      const picked = await storiesPickExportFolder();
      if (!picked.canceled && picked.destDir) {
        setExportDestDir(picked.destDir);
      }
    } catch (err) {
      reportAppErrorFromUnknown("Could not choose folder", err);
    } finally {
      setIsPickingFolder(false);
    }
  };

  const confirmExport = async () => {
    if (!exportDestDir) return;
    setIsExporting(true);
    try {
      const result = await storiesExport(exportDestDir);
      if (result.fileCount === 0) {
        reportAppError("No .yaml files to export.");
        return;
      }
      setExportDialogOpen(false);
      setExportPreview(null);
      setExportDestDir("");
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

  return {
    isImporting,
    isExporting,
    startImport,
    startExport,
    importDialog: (
      <ImportStoriesDialog
        open={importDialogOpen}
        preview={importPreview}
        isImporting={isImporting}
        onOpenChange={(open) => {
          if (isImporting) return;
          setImportDialogOpen(open);
          if (!open) {
            setImportPreview(null);
            setImportPaths([]);
          }
        }}
        onImport={confirmImport}
      />
    ),
    exportDialog: (
      <ExportStoriesDialog
        open={exportDialogOpen}
        preview={exportPreview}
        destDir={exportDestDir}
        isExporting={isExporting}
        isPickingFolder={isPickingFolder}
        onOpenChange={(open) => {
          if (isExporting) return;
          setExportDialogOpen(open);
          if (!open) {
            setExportPreview(null);
            setExportDestDir("");
          }
        }}
        onPickFolder={pickExportFolder}
        onExport={confirmExport}
      />
    ),
  };
}
