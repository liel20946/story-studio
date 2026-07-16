import * as React from "react";
import { useParams, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  PlayIcon,
  Loader2Icon,
  PencilIcon,
  CircleDotIcon,
  HistoryIcon,
} from "lucide-react";
import {
  ScrollArea,
  Toolbar,
  ToolbarRow,
  ToolbarContent,
  ToolbarTitle,
  ToolbarActions,
  Button,
  Text,
  EmptyState,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui";
import {
  storiesGet,
  storiesList,
  storiesUpdate,
  runStart,
} from "../lib/ipc";
import { cn } from "@/lib/utils";
import { reportAppErrorFromUnknown } from "@/lib/app-error";
import type { StoryDetail } from "../lib/contract-types";
import { stripCode } from "../components/inline-code";
import {
  StoryDetailPanel,
  StoryDetailPanelSection,
  StoryVariableTable,
  StoryAssertionList,
  storyEditInputClass,
} from "../components/story-detail-panel";
import { StorySteps } from "../components/story-steps";
import { useActiveRunForStory, useRegisterRun } from "../lib/run-store";
import { buildVarColors } from "../lib/story-var-colors";

// ---------- section (loading shell) ----------
function Section({
  title,
  children,
  className,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("codex-section", className)}>
      <span className="section-label">{title}</span>
      {children}
    </div>
  );
}

type StoryEditDraft = {
  steps: string[];
  variables: { key: string; value: string }[];
  assertions: string[];
};

function isBlankAssertion(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length === 0 || /^verify\s*$/i.test(trimmed);
}

function cleanDraftForSave(draft: StoryEditDraft): StoryEditDraft {
  return {
    ...draft,
    steps: draft.steps.map((s) => s.trim()).filter((s) => s.length > 0),
    variables: draft.variables.filter((v) => v.key.trim().length > 0),
    assertions: draft.assertions.filter((a) => !isBlankAssertion(a)),
  };
}

function storyToDraft(story: StoryDetail): StoryEditDraft {
  return {
    steps: story.steps.length > 0 ? [...story.steps] : [""],
    variables:
      story.variables.length > 0
        ? story.variables.map((v) => ({
            key: stripCode(v.key),
            value: stripCode(v.value),
          }))
        : [{ key: "", value: "" }],
    assertions: story.assertions.length > 0 ? [...story.assertions] : [""],
  };
}

function cloneDraft(draft: StoryEditDraft): StoryEditDraft {
  return {
    steps: [...draft.steps],
    variables: draft.variables.map((v) => ({ ...v })),
    assertions: [...draft.assertions],
  };
}

function draftsEqual(a: StoryEditDraft, b: StoryEditDraft): boolean {
  return (
    a.steps.length === b.steps.length &&
    a.assertions.length === b.assertions.length &&
    a.variables.length === b.variables.length &&
    a.steps.every((step, i) => step === b.steps[i]) &&
    a.assertions.every((assertion, i) => assertion === b.assertions[i]) &&
    a.variables.every(
      (variable, i) =>
        variable.key === b.variables[i].key && variable.value === b.variables[i].value,
    )
  );
}

const DRAFT_UNDO_DEBOUNCE_MS = 400;
const DRAFT_HISTORY_LIMIT = 50;

function useEditableDraft() {
  const [draft, setDraftState] = React.useState<StoryEditDraft | null>(null);
  const undoStack = React.useRef<StoryEditDraft[]>([]);
  const redoStack = React.useRef<StoryEditDraft[]>([]);
  const pendingCheckpoint = React.useRef<StoryEditDraft | null>(null);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const applyingHistory = React.useRef(false);

  const flushCheckpoint = React.useCallback(() => {
    if (!pendingCheckpoint.current) return;
    const snapshot = pendingCheckpoint.current;
    pendingCheckpoint.current = null;
    const stack = undoStack.current;
    const last = stack[stack.length - 1];
    if (!last || !draftsEqual(last, snapshot)) {
      stack.push(snapshot);
      if (stack.length > DRAFT_HISTORY_LIMIT) stack.shift();
    }
    redoStack.current = [];
  }, []);

  const clearTimers = React.useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, []);

  const resetHistory = React.useCallback(() => {
    undoStack.current = [];
    redoStack.current = [];
    pendingCheckpoint.current = null;
    clearTimers();
  }, [clearTimers]);

  const beginEdit = React.useCallback((initial: StoryEditDraft) => {
    resetHistory();
    setDraftState(cloneDraft(initial));
  }, [resetHistory]);

  const clearEdit = React.useCallback(() => {
    resetHistory();
    setDraftState(null);
  }, [resetHistory]);

  const setDraft = React.useCallback(
    (next: StoryEditDraft | ((prev: StoryEditDraft) => StoryEditDraft)) => {
      setDraftState((prev) => {
        if (!prev) return prev;
        const resolved = typeof next === "function" ? next(prev) : next;
        if (applyingHistory.current || draftsEqual(prev, resolved)) return resolved;

        if (!pendingCheckpoint.current) {
          pendingCheckpoint.current = cloneDraft(prev);
        }
        clearTimers();
        debounceRef.current = setTimeout(flushCheckpoint, DRAFT_UNDO_DEBOUNCE_MS);
        return resolved;
      });
    },
    [clearTimers, flushCheckpoint],
  );

  const setDraftNow = React.useCallback(
    (next: StoryEditDraft | ((prev: StoryEditDraft) => StoryEditDraft)) => {
      setDraftState((prev) => {
        if (!prev) return prev;
        const resolved = typeof next === "function" ? next(prev) : next;
        if (applyingHistory.current || draftsEqual(prev, resolved)) return resolved;

        flushCheckpoint();
        clearTimers();
        pendingCheckpoint.current = null;
        const stack = undoStack.current;
        const last = stack[stack.length - 1];
        if (!last || !draftsEqual(last, prev)) {
          stack.push(cloneDraft(prev));
          if (stack.length > DRAFT_HISTORY_LIMIT) stack.shift();
        }
        redoStack.current = [];
        return resolved;
      });
    },
    [clearTimers, flushCheckpoint],
  );

  const undo = React.useCallback(() => {
    clearTimers();
    setDraftState((current) => {
      if (!current) return current;

      if (
        pendingCheckpoint.current &&
        !draftsEqual(current, pendingCheckpoint.current)
      ) {
        applyingHistory.current = true;
        redoStack.current.push(cloneDraft(current));
        const restored = cloneDraft(pendingCheckpoint.current);
        pendingCheckpoint.current = null;
        queueMicrotask(() => {
          applyingHistory.current = false;
        });
        return restored;
      }

      flushCheckpoint();
      if (undoStack.current.length === 0) return current;

      applyingHistory.current = true;
      const previous = undoStack.current.pop()!;
      redoStack.current.push(cloneDraft(current));
      const restored = cloneDraft(previous);
      queueMicrotask(() => {
        applyingHistory.current = false;
      });
      return restored;
    });
  }, [clearTimers, flushCheckpoint]);

  const redo = React.useCallback(() => {
    flushCheckpoint();
    clearTimers();
    setDraftState((current) => {
      if (!current || redoStack.current.length === 0) return current;
      applyingHistory.current = true;
      const next = redoStack.current.pop()!;
      undoStack.current.push(cloneDraft(current));
      const restored = cloneDraft(next);
      queueMicrotask(() => {
        applyingHistory.current = false;
      });
      return restored;
    });
  }, [clearTimers, flushCheckpoint]);

  React.useEffect(() => () => clearTimers(), [clearTimers]);

  return {
    draft,
    setDraft,
    setDraftNow,
    beginEdit,
    clearEdit,
    undo,
    redo,
    commitCheckpoint: flushCheckpoint,
  };
}

function isUndoShortcut(e: KeyboardEvent) {
  return (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !e.altKey;
}

function focusInputAt(refs: React.RefObject<(HTMLInputElement | null)[]>, index: number) {
  requestAnimationFrame(() => {
    refs.current[index]?.focus();
  });
}

function insertRow<T>(rows: T[], index: number, item: T): T[] {
  const next = [...rows];
  next.splice(index + 1, 0, item);
  return next;
}

function removeRow<T>(rows: T[], index: number): T[] {
  if (rows.length <= 1) return rows;
  return rows.filter((_, i) => i !== index);
}

function handleTextRowKeyDown(
  e: React.KeyboardEvent<HTMLInputElement>,
  index: number,
  value: string,
  rows: string[],
  onRowsChange: (rows: string[], immediate?: boolean) => void,
  inputRefs: React.RefObject<(HTMLInputElement | null)[]>,
) {
  if (isUndoShortcut(e.nativeEvent)) return;

  if (e.key === "Enter") {
    e.preventDefault();
    onRowsChange(insertRow(rows, index, ""), true);
    focusInputAt(inputRefs, index + 1);
    return;
  }
  if (e.key === "Backspace" && value === "" && rows.length > 1) {
    e.preventDefault();
    onRowsChange(removeRow(rows, index), true);
    focusInputAt(inputRefs, Math.max(0, index - 1));
  }
}

function updateTextRow(
  index: number,
  value: string,
  rows: string[],
  onRowsChange: (rows: string[]) => void,
) {
  const next = [...rows];
  next[index] = value;
  onRowsChange(next);
}

function StoryLoadingShell({ title }: { title: string }) {
  return (
    <ScrollArea
      toolbar={
        <Toolbar titlebar surface="main" seamless>
          <ToolbarRow inset="main" className="main-titlebar-row detail-view-toolbar">
            <ToolbarContent className="detail-view-toolbar-content">
              <ToolbarTitle>{title}</ToolbarTitle>
            </ToolbarContent>
          </ToolbarRow>
        </Toolbar>
      }
    >
      <div className="detail-view story-loading-shell">
        <div className="detail-view-main story-sections">
          <div className="codex-section">
            <span className="section-label">Steps</span>
            <div className="story-loading-shell-lines" aria-hidden>
              <span />
              <span />
              <span />
            </div>
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}

export function StoryView() {
  const { name } = useParams({ from: "/story/$name" });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const registerRun = useRegisterRun();
  const [isStarting, setIsStarting] = React.useState(false);
  const [editingStoryName, setEditingStoryName] = React.useState<string | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);
  const {
    draft,
    setDraft,
    setDraftNow,
    beginEdit,
    clearEdit,
    undo,
    redo,
    commitCheckpoint,
  } = useEditableDraft();
  const stepInputRefs = React.useRef<(HTMLInputElement | null)[]>([]);
  const assertionInputRefs = React.useRef<(HTMLInputElement | null)[]>([]);
  const variableKeyInputRefs = React.useRef<(HTMLInputElement | null)[]>([]);
  const variableValueInputRefs = React.useRef<(HTMLInputElement | null)[]>([]);

  const storyQuery = useQuery({
    queryKey: ["stories:get", name],
    queryFn: () => storiesGet(name),
  });

  const storiesListQuery = useQuery({
    queryKey: ["stories:list"],
    queryFn: storiesList,
  });

  // Deleted stories stay in the stories:get cache; redirect home once the list
  // no longer contains this story.
  React.useEffect(() => {
    const stories = storiesListQuery.data;
    if (!stories) return;
    if (!stories.some((s) => s.name === name)) {
      navigate({ to: "/stories" });
    }
  }, [storiesListQuery.data, name, navigate]);

  const story = storyQuery.isError ? undefined : storyQuery.data;
  const storyReady = story?.name === name;
  const storyTitle =
    storiesListQuery.data?.find((s) => s.name === name)?.title ?? name;
  const activeRun = useActiveRunForStory(name, story?.title);
  const isEditingThisStory = editingStoryName === name;

  // Stable color per variable name, reused across the Variables list and the
  // inline chips in Steps/Assertions.
  const varColors = React.useMemo(() => {
    if (!story) return { text: {}, chip: {} };
    if (isEditingThisStory && draft) {
      return buildVarColors(draft.variables);
    }
    return buildVarColors(story.variables);
  }, [story, isEditingThisStory, draft]);

  React.useEffect(() => {
    if (editingStoryName && editingStoryName !== name) {
      setEditingStoryName(null);
      clearEdit();
    }
  }, [name, editingStoryName, clearEdit]);

  React.useEffect(() => {
    if (!isEditingThisStory) return;

    function onKeyDown(e: KeyboardEvent) {
      if (!isUndoShortcut(e)) return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    }

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [isEditingThisStory, undo, redo]);

  function updateDraftSteps(steps: string[], immediate = false) {
    const apply = immediate ? setDraftNow : setDraft;
    apply((prev) => ({ ...prev, steps }));
  }

  function updateDraftAssertions(assertions: string[], immediate = false) {
    const apply = immediate ? setDraftNow : setDraft;
    apply((prev) => ({ ...prev, assertions }));
  }

  function updateDraftVariables(
    variables: StoryEditDraft["variables"],
    immediate = false,
  ) {
    const apply = immediate ? setDraftNow : setDraft;
    apply((prev) => ({ ...prev, variables }));
  }

  async function handleRun() {
    if (!story || isStarting) return;
    // Already running in the background → jump to its live timeline.
    if (activeRun) {
      navigate({ to: "/run/$runId", params: { runId: activeRun.runId } });
      return;
    }
    setIsStarting(true);
    try {
      const { runId, agentProvider, agentModel } = await runStart(story.name);
      registerRun(runId, story.name, story.title, { agentProvider, agentModel });
      navigate({ to: "/run/$runId", params: { runId } });
    } catch (err) {
      reportAppErrorFromUnknown("Failed to start run", err);
    } finally {
      setIsStarting(false);
    }
  }

  function handleEdit() {
    if (!story) return;
    beginEdit(storyToDraft(story));
    setEditingStoryName(story.name);
  }

  async function handleSave() {
    if (!story || !draft || isSaving) return;
    setIsSaving(true);
    try {
      const updated = await storiesUpdate(story.name, cleanDraftForSave(draft));
      queryClient.setQueryData(["stories:get", name], updated);
      void queryClient.invalidateQueries({ queryKey: ["stories:list"] });
      setEditingStoryName(null);
      clearEdit();
    } catch (err) {
      reportAppErrorFromUnknown("Failed to save story", err);
    } finally {
      setIsSaving(false);
    }
  }

  function handleCancel() {
    setEditingStoryName(null);
    clearEdit();
  }

  function handleRecordAgain() {
    const baseUrl = story.baseUrl ?? "";
    navigate({
      to: "/record",
      search: { storyKey: name, title: story.title, url: baseUrl },
    });
  }

  if (!storyReady) {
    if (storyQuery.isError) {
      return (
        <ScrollArea title="Story">
          <EmptyState
            title="Story not found"
            description="This story may have been deleted."
            actions={
              <Button variant="filled" onClick={() => navigate({ to: "/stories" })}>
                Go back
              </Button>
            }
          />
        </ScrollArea>
      );
    }

    return <StoryLoadingShell title={storyTitle} />;
  }

  if (!story) {
    return (
      <ScrollArea title="Story">
        <EmptyState
          title="Story not found"
          description="This story may have been deleted."
          actions={
            <Button variant="filled" onClick={() => navigate({ to: "/stories" })}>
              Go back
            </Button>
          }
        />
      </ScrollArea>
    );
  }

  return (
    <ScrollArea
      toolbar={
        <Toolbar titlebar surface="main" seamless>
          <ToolbarRow inset="main" className="main-titlebar-row detail-view-toolbar">
            <ToolbarContent className="detail-view-toolbar-content">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <ToolbarTitle>{story.title}</ToolbarTitle>
              </div>
            </ToolbarContent>
            <ToolbarActions className="detail-view-toolbar-actions">
              {isEditingThisStory ? (
                <>
                  <Button
                    variant="transparent"
                    size="titlebar"
                    radius="full"
                    onClick={handleCancel}
                    disabled={isSaving}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="filled"
                    size="titlebar"
                    radius="full"
                    onClick={handleSave}
                    disabled={isSaving}
                  >
                    {isSaving ? (
                      <Loader2Icon className="size-4 animate-spin text-accent" />
                    ) : (
                      <CheckIcon className="size-4" />
                    )}
                    Save
                  </Button>
                </>
              ) : (
                <>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="transparent"
                        size="titlebar"
                        iconOnly
                        onClick={handleEdit}
                        aria-label="Edit story"
                      >
                        <PencilIcon className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Edit story</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="transparent"
                        size="titlebar"
                        iconOnly
                        onClick={handleRecordAgain}
                        aria-label="Record again"
                      >
                        <CircleDotIcon className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Record again</TooltipContent>
                  </Tooltip>
                  <Button
                    variant={activeRun ? "filled" : "accent"}
                    size="titlebar"
                    radius="full"
                    onClick={handleRun}
                    disabled={isStarting}
                  >
                    {isStarting ? (
                      <Loader2Icon className="size-4 animate-spin" />
                    ) : activeRun ? (
                      <HistoryIcon className="size-4" />
                    ) : (
                      <PlayIcon className="size-4" />
                    )}
                    {activeRun ? "View run" : "Run"}
                  </Button>
                </>
              )}
            </ToolbarActions>
          </ToolbarRow>
        </Toolbar>
      }
    >
      <div className="detail-view detail-view--story">
        <StoryDetailPanel>
          {(isEditingThisStory && draft) || story.variables.length > 0 ? (
            <StoryDetailPanelSection title="Variables">
              <StoryVariableTable
                variables={
                  isEditingThisStory && draft
                    ? draft.variables
                    : story.variables.map((v) => ({
                        key: v.key,
                        value: v.value,
                        secret: v.secret,
                      }))
                }
                nameColors={varColors.text}
                editable={Boolean(isEditingThisStory && draft)}
                showCopy={!isEditingThisStory}
                keyInputRefs={variableKeyInputRefs}
                valueInputRefs={variableValueInputRefs}
                onVariableChange={(variables) => updateDraftVariables(variables)}
                onVariablesChangeNow={(variables) => updateDraftVariables(variables, true)}
                onCommit={commitCheckpoint}
              />
            </StoryDetailPanelSection>
          ) : null}

          {(isEditingThisStory && draft) || story.steps.length > 0 ? (
            <StoryDetailPanelSection title="Steps">
              <StorySteps
                steps={isEditingThisStory && draft ? draft.steps : story.steps}
                colorMap={varColors.chip}
                editable={Boolean(isEditingThisStory && draft)}
                stepInputRefs={stepInputRefs}
                inputClassName={cn(storyEditInputClass, "text-[12px] leading-[16px] text-secondary")}
                onStepChange={(i, value) =>
                  updateTextRow(
                    i,
                    value,
                    draft!.steps,
                    (steps) => updateDraftSteps(steps),
                  )
                }
                onStepKeyDown={(e, i, step) =>
                  handleTextRowKeyDown(
                    e,
                    i,
                    step,
                    draft!.steps,
                    (steps, immediate) => updateDraftSteps(steps, immediate),
                    stepInputRefs,
                  )
                }
                onCommit={commitCheckpoint}
              />
            </StoryDetailPanelSection>
          ) : (
            <EmptyState placement="inline" title="No steps yet." />
          )}

          {(isEditingThisStory && draft) || story.assertions.length > 0 ? (
            <StoryDetailPanelSection title="Assertions">
              <StoryAssertionList
                assertions={
                  isEditingThisStory && draft ? draft.assertions : story.assertions
                }
                colorMap={varColors.chip}
                editable={Boolean(isEditingThisStory && draft)}
                inputRefs={assertionInputRefs}
                inputClassName={cn(
                  storyEditInputClass,
                  "text-[11px] leading-[15px] text-secondary text-center",
                )}
                onAssertionChange={(i, value) =>
                  updateTextRow(
                    i,
                    value,
                    draft!.assertions,
                    (assertions) => updateDraftAssertions(assertions),
                  )
                }
                onAssertionKeyDown={(e, i, assertion) =>
                  handleTextRowKeyDown(
                    e,
                    i,
                    assertion,
                    draft!.assertions,
                    (assertions, immediate) =>
                      updateDraftAssertions(assertions, immediate),
                    assertionInputRefs,
                  )
                }
                onCommit={commitCheckpoint}
              />
            </StoryDetailPanelSection>
          ) : null}
        </StoryDetailPanel>
      </div>
    </ScrollArea>
  );
}
