import * as React from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  FileIcon,
  FolderIcon,
  Loader2Icon,
  PlusIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
  DialogClose,
  Button,
  Text,
  Input,
  Textarea,
} from "@/components/ui";
import { SkillComposer } from "@/components/generate/skill-composer";
import { reportAppErrorFromUnknown } from "@/lib/app-error";
import {
  bulkCancelGenerateVariables,
  bulkGenerateVariables,
  bulkPickContextPaths,
  onBulkGenerateProgress,
} from "@/lib/ipc";
import type { BulkVariableRun, StoryDetail } from "@/lib/contract-types";

type Phase = "chat" | "generating" | "review";

type Attachment = {
  path: string;
  kind: "file" | "folder";
};

function basename(filePath: string): string {
  const parts = filePath.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || filePath;
}

function AttachPlusMenu({
  disabled,
  busy,
  onAttach,
}: {
  disabled?: boolean;
  busy?: boolean;
  onAttach: (mode: "files" | "folder") => void;
}) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="generate-composer-attach-btn"
          disabled={disabled || busy}
          aria-label="Attach files or folder"
        >
          {busy ? (
            <Loader2Icon className="generate-composer-attach-btn-icon animate-spin" />
          ) : (
            <PlusIcon className="generate-composer-attach-btn-icon" absoluteStrokeWidth />
          )}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="generate-composer-attach-menu"
          side="top"
          align="start"
          sideOffset={6}
        >
          <DropdownMenu.Item
            className="generate-composer-attach-menu-item"
            onSelect={() => onAttach("files")}
          >
            <FileIcon className="generate-composer-attach-menu-item-icon" />
            Attach files
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className="generate-composer-attach-menu-item"
            onSelect={() => onAttach("folder")}
          >
            <FolderIcon className="generate-composer-attach-menu-item-icon" />
            Attach folder
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function BulkVariablesModal({
  open,
  onOpenChange,
  story,
  initialRuns,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  story: StoryDetail | null;
  initialRuns?: BulkVariableRun[];
  onSave: (runs: BulkVariableRun[]) => void;
}) {
  const [phase, setPhase] = React.useState<Phase>("chat");
  const [prompt, setPrompt] = React.useState("");
  const [runs, setRuns] = React.useState<BulkVariableRun[]>([]);
  const [statusText, setStatusText] = React.useState("");
  const [attachedPaths, setAttachedPaths] = React.useState<Attachment[]>([]);
  const [pickingAttachments, setPickingAttachments] = React.useState(false);
  const invocationRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setPhase(initialRuns?.length ? "review" : "chat");
    setPrompt("");
    setRuns(initialRuns ?? []);
    setStatusText("");
    setAttachedPaths([]);
    setPickingAttachments(false);
    invocationRef.current = null;
  }, [open, story?.name, initialRuns]);

  React.useEffect(() => {
    if (!open) return;
    return onBulkGenerateProgress((progress) => {
      if (progress.invocationId !== invocationRef.current) return;
      if (progress.message.trim()) setStatusText(progress.message);
    });
  }, [open]);

  function cancelInFlightGenerate() {
    const id = invocationRef.current;
    if (id) void bulkCancelGenerateVariables(id);
    invocationRef.current = null;
  }

  function handleDialogOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      cancelInFlightGenerate();
      setPhase(initialRuns?.length ? "review" : "chat");
      setStatusText("");
    }
    onOpenChange(nextOpen);
  }

  async function handleAttach(mode: "files" | "folder") {
    if (pickingAttachments || phase === "generating") return;
    setPickingAttachments(true);
    try {
      const result = await bulkPickContextPaths(mode);
      if (result.canceled) return;
      setAttachedPaths((prev) => {
        const byPath = new Map(prev.map((a) => [a.path, a]));
        for (const p of result.paths) {
          byPath.set(p, { path: p, kind: mode === "folder" ? "folder" : "file" });
        }
        return [...byPath.values()];
      });
    } catch (err) {
      reportAppErrorFromUnknown("Failed to attach files", err);
    } finally {
      setPickingAttachments(false);
    }
  }

  function removeAttachment(path: string) {
    setAttachedPaths((prev) => prev.filter((a) => a.path !== path));
  }

  async function handleGenerate() {
    if (!story || !prompt.trim() || phase === "generating") return;
    const invocationId = crypto.randomUUID();
    invocationRef.current = invocationId;
    setPhase("generating");
    setStatusText("Talking with the agent…");
    try {
      const result = await bulkGenerateVariables(
        story.name,
        prompt.trim(),
        invocationId,
        attachedPaths.map((a) => a.path),
      );
      if (invocationRef.current !== invocationId) return;
      setRuns(result.runs);
      setPhase("review");
      setStatusText("");
    } catch (err) {
      if (invocationRef.current !== invocationId) return;
      reportAppErrorFromUnknown("Failed to generate variable runs", err);
      setPhase("chat");
      setStatusText("");
    } finally {
      if (invocationRef.current === invocationId) {
        invocationRef.current = null;
      }
    }
  }

  function handleCancelGenerate() {
    cancelInFlightGenerate();
    setPhase("chat");
    setStatusText("");
  }

  function updateRunLabel(index: number, label: string) {
    setRuns((prev) =>
      prev.map((run, i) => (i === index ? { ...run, label } : run)),
    );
  }

  function updateRunVariable(index: number, key: string, value: string) {
    setRuns((prev) =>
      prev.map((run, i) =>
        i === index ? { ...run, variables: { ...run.variables, [key]: value } } : run,
      ),
    );
  }

  function addRun() {
    const keys = story?.variables.map((v) => v.key) ?? Object.keys(runs[0]?.variables ?? {});
    const variables = Object.fromEntries(keys.map((key) => [key, ""]));
    setRuns((prev) => [
      ...prev,
      { id: crypto.randomUUID(), label: `Run ${prev.length + 1}`, variables },
    ]);
    setPhase("review");
  }

  function removeRun(index: number) {
    setRuns((prev) => prev.filter((_, i) => i !== index));
  }

  function handleApprove() {
    if (runs.length === 0) return;
    onSave(runs);
    onOpenChange(false);
  }

  if (!story) return null;

  const variableKeys =
    story.variables.length > 0
      ? story.variables.map((v) => v.key)
      : Array.from(new Set(runs.flatMap((run) => Object.keys(run.variables))));
  const secretKeys = new Set(
    story.variables.filter((v) => v.secret).map((v) => v.key),
  );

  function blockDismissWhilePicking(event: Event) {
    if (pickingAttachments) event.preventDefault();
  }

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange} modal={!pickingAttachments}>
      <DialogContent
        size="large"
        className="max-h-[min(88vh,760px)]"
        hideOverlay={pickingAttachments}
        onEscapeKeyDown={(e) => {
          if (pickingAttachments) e.preventDefault();
        }}
        onPointerDownOutside={blockDismissWhilePicking}
        onInteractOutside={blockDismissWhilePicking}
        onFocusOutside={blockDismissWhilePicking}
      >
        <DialogHeader>
          <DialogTitle>Variable runs: {story.title}</DialogTitle>
          <DialogDescription>
            Describe how to vary this story across runs. Attach files or folders
            when the agent should use their contents.
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          <div className="flex min-h-0 max-h-[min(52vh,480px)] flex-col overflow-hidden">
          {phase === "chat" && (
            <div className="flex flex-col gap-3">
              <div className="rounded-control border border-separator bg-surface px-3 py-2">
                <Text variant="small-strong" color="secondary">
                  Story variables
                </Text>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {story.variables.length > 0 ? (
                    story.variables.map((v) => (
                      <span
                        key={v.key}
                        className="rounded-full bg-control px-2 py-0.5 font-mono text-[11px] text-secondary"
                      >
                        {v.key}
                      </span>
                    ))
                  ) : (
                    <Text variant="small" color="tertiary">
                      No variables defined. The agent will infer keys from the workflow.
                    </Text>
                  )}
                </div>
              </div>

              {attachedPaths.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {attachedPaths.map((attachment) => {
                    const Icon = attachment.kind === "folder" ? FolderIcon : FileIcon;
                    const name = basename(attachment.path);
                    return (
                      <span
                        key={attachment.path}
                        className="inline-flex max-w-full items-center gap-1 rounded-control border border-separator bg-control px-2 py-1 text-[11px] text-secondary"
                        title={attachment.path}
                      >
                        <Icon className="size-3.5 shrink-0" />
                        <span className="truncate">{name}</span>
                        <button
                          type="button"
                          className="ml-0.5 rounded-sm p-0.5 text-tertiary hover:bg-surface hover:text-primary"
                          aria-label={`Remove ${name}`}
                          onClick={() => removeAttachment(attachment.path)}
                        >
                          <XIcon className="size-3" />
                        </button>
                      </span>
                    );
                  })}
                </div>
              ) : null}

              <SkillComposer
                layout="inline"
                value={prompt}
                onChange={setPrompt}
                onSubmit={() => void handleGenerate()}
                showSkill
                skillLabel="bulk-variables"
                placeholder='e.g. "One run per attached HTML file for the paste body"'
                leading={
                  <AttachPlusMenu
                    busy={pickingAttachments}
                    onAttach={(mode) => void handleAttach(mode)}
                  />
                }
              />
            </div>
          )}

          {phase === "generating" && (
            <div className="flex min-h-[160px] flex-col items-center justify-center gap-3">
              <Loader2Icon className="size-8 animate-spin text-accent" />
              <Text variant="regular" color="secondary">
                {statusText || "Generating variable sets…"}
              </Text>
            </div>
          )}

          {phase === "review" && (
            <div className="flex max-h-[min(52vh,420px)] flex-col gap-3 overflow-y-auto pr-1">
              {runs.map((run, index) => (
                <div
                  key={run.id}
                  className="rounded-control border border-separator bg-surface p-3"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <Input
                      aria-label={`Run label ${index + 1}`}
                      value={run.label}
                      onChange={(e) => updateRunLabel(index, e.target.value)}
                      className="h-8 flex-1"
                    />
                    <Button
                      variant="glass"
                      size="small"
                      iconOnly
                      aria-label="Remove run"
                      onClick={() => removeRun(index)}
                      disabled={runs.length <= 1}
                    >
                      <Trash2Icon className="size-4" />
                    </Button>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {variableKeys.map((key) => {
                      const value = run.variables[key] ?? "";
                      const multiline =
                        value.includes("\n") ||
                        value.length > 80 ||
                        /<[a-z][\s\S]*>/i.test(value);
                      return (
                      <div key={key} className="grid grid-cols-[7rem_1fr] items-start gap-2">
                        <Text variant="small" className="truncate pt-2 font-mono text-tertiary">
                          {key}
                        </Text>
                        {multiline ? (
                          <Textarea
                            aria-label={`${run.label} ${key}`}
                            autoComplete="off"
                            value={value}
                            onChange={(e) => updateRunVariable(index, key, e.target.value)}
                            rows={6}
                            className="min-h-[5.5rem] font-mono text-[12px]"
                          />
                        ) : (
                          <Input
                            aria-label={`${run.label} ${key}`}
                            type={secretKeys.has(key) ? "password" : "text"}
                            autoComplete="off"
                            value={value}
                            onChange={(e) => updateRunVariable(index, key, e.target.value)}
                            className="h-8 font-mono text-[12px]"
                          />
                        )}
                      </div>
                      );
                    })}
                  </div>
                </div>
              ))}
              <Button variant="glass" size="small" className="self-start" onClick={addRun}>
                <PlusIcon className="size-4" />
                Add run
              </Button>
              {runs.length === 0 ? (
                <Textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Describe the variable runs you want…"
                  rows={3}
                />
              ) : null}
            </div>
          )}
          </div>
        </DialogBody>

        <DialogFooter>
          {phase === "generating" ? (
            <Button variant="filled" onClick={handleCancelGenerate}>
              Cancel
            </Button>
          ) : (
            <DialogClose asChild>
              <Button variant="filled">Cancel</Button>
            </DialogClose>
          )}
          {phase === "review" ? (
            <>
              <Button variant="glass" onClick={() => setPhase("chat")}>
                Regenerate
              </Button>
              <Button variant="accent" disabled={runs.length === 0} onClick={handleApprove}>
                Save for bulk
              </Button>
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
