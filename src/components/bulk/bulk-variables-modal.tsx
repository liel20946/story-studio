import * as React from "react";
import { ArrowUpIcon, Loader2Icon, PlusIcon, Trash2Icon } from "lucide-react";
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
import { bulkCancelGenerateVariables, bulkGenerateVariables } from "@/lib/ipc";
import type { BulkVariableRun, StoryDetail } from "@/lib/contract-types";

type Phase = "chat" | "generating" | "review";

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
  const invocationRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setPhase(initialRuns?.length ? "review" : "chat");
    setPrompt("");
    setRuns(initialRuns ?? []);
    setStatusText("");
    invocationRef.current = null;
  }, [open, story?.name, initialRuns]);

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
      );
      setRuns(result.runs);
      setPhase("review");
      setStatusText("");
    } catch (err) {
      reportAppErrorFromUnknown("Failed to generate variable runs", err);
      setPhase("chat");
      setStatusText("");
    } finally {
      invocationRef.current = null;
    }
  }

  function handleCancelGenerate() {
    const id = invocationRef.current;
    if (id) void bulkCancelGenerateVariables(id);
    setPhase("chat");
    setStatusText("");
    invocationRef.current = null;
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="large" className="max-h-[min(88vh,760px)]">
        <DialogHeader>
          <DialogTitle>Variable runs — {story.title}</DialogTitle>
          <DialogDescription>
            Describe how you want to run this story multiple times. The agent builds
            variable sets you can edit before saving.
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          <div className="min-h-0 flex max-h-[min(52vh,480px)] flex-col overflow-hidden">
          {phase === "chat" && (
            <div className="flex h-full min-h-[280px] flex-col gap-4">
              <div className="rounded-control border border-separator bg-surface px-3 py-2">
                <Text variant="small-strong" color="secondary">
                  Story variables
                </Text>
                <div className="mt-1 flex flex-wrap gap-1.5">
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
                      No variables defined — the agent will infer keys from the workflow.
                    </Text>
                  )}
                </div>
              </div>
              <div className="mt-auto">
                <SkillComposer
                  layout="inline"
                  value={prompt}
                  onChange={setPrompt}
                  onSubmit={() => void handleGenerate()}
                  showSkill
                  placeholder='e.g. "Run as admin and guest with different emails"'
                />
              </div>
            </div>
          )}

          {phase === "generating" && (
            <div className="flex min-h-[240px] flex-col items-center justify-center gap-3">
              <Loader2Icon className="size-8 animate-spin text-accent" />
              <Text variant="regular" color="secondary">
                {statusText || "Generating variable sets…"}
              </Text>
              <Button variant="glass" size="small" onClick={handleCancelGenerate}>
                Cancel
              </Button>
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
                    {variableKeys.map((key) => (
                      <div key={key} className="grid grid-cols-[7rem_1fr] items-center gap-2">
                        <Text variant="small" className="truncate font-mono text-tertiary">
                          {key}
                        </Text>
                        <Input
                          aria-label={`${run.label} ${key}`}
                          value={run.variables[key] ?? ""}
                          onChange={(e) => updateRunVariable(index, key, e.target.value)}
                          className="h-8 font-mono text-[12px]"
                        />
                      </div>
                    ))}
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
          <DialogClose asChild>
            <Button variant="filled">Cancel</Button>
          </DialogClose>
          {phase === "review" ? (
            <>
              <Button variant="glass" onClick={() => setPhase("chat")}>
                Regenerate
              </Button>
              <Button variant="accent" disabled={runs.length === 0} onClick={handleApprove}>
                Save for bulk
              </Button>
            </>
          ) : phase === "chat" ? (
            <Button
              variant="accent"
              disabled={!prompt.trim()}
              onClick={() => void handleGenerate()}
            >
              <ArrowUpIcon className="size-4" />
              Generate
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
