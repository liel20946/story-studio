import * as React from "react";
import { useParams, useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  PlayIcon,
  Loader2Icon,
  PencilIcon,
  CircleDotIcon,
  CopyIcon,
  CheckIcon,
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
} from "@/components/ui";
import {
  storiesGet,
  storiesList,
  storiesUpdate,
  storiesDuplicate,
  clipboardWriteText,
  runStart,
} from "../lib/ipc";
import { cn } from "@/lib/utils";
import { reportAppErrorFromUnknown } from "@/lib/app-error";
import type { StoryDetail, StorySummary } from "../lib/contract-types";
import { InlineCode, stripCode } from "../components/inline-code";
import { RailAssertionLine } from "../components/rail-assertion-line";
import { useActiveRunForStory, useRegisterRun } from "../lib/run-store";
import { buildVarColors } from "../lib/story-var-colors";

// ---------- section (Steps on the left; Variables / Assertions on the rail) ----------
function Section({
  title,
  children,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="codex-section">
      <span className="section-label">{title}</span>
      {children}
    </div>
  );
}

// ---------- copy-to-clipboard button (with transient "copied" check) ----------
function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function handleCopy() {
    try {
      await clipboardWriteText(value);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1200);
    } catch (err) {
      reportAppErrorFromUnknown("Failed to copy variable", err);
    }
  }

  return (
    <button
      type="button"
      aria-label={label}
      onClick={handleCopy}
      className="flex items-center text-tertiary transition-colors hover:text-secondary"
    >
      {copied ? (
        <CheckIcon className="size-3.5 text-support-green" />
      ) : (
        <CopyIcon className="size-3.5" />
      )}
    </button>
  );
}

type StoryEditDraft = {
  steps: string[];
  variables: { key: string; value: string }[];
  assertions: string[];
  globalRules: string;
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
    globalRules: draft.globalRules.trim(),
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
    globalRules: story.globalRules ?? "",
  };
}

function cloneDraft(draft: StoryEditDraft): StoryEditDraft {
  return {
    steps: [...draft.steps],
    variables: draft.variables.map((v) => ({ ...v })),
    assertions: [...draft.assertions],
    globalRules: draft.globalRules,
  };
}

function draftsEqual(a: StoryEditDraft, b: StoryEditDraft): boolean {
  return (
    a.steps.length === b.steps.length &&
    a.assertions.length === b.assertions.length &&
    a.variables.length === b.variables.length &&
    a.globalRules === b.globalRules &&
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

const storyEditInputClass =
  "min-w-0 w-full bg-transparent border-0 outline-none p-0 text-inherit font-inherit leading-inherit focus:ring-1 focus:ring-field/60 rounded-sm";

// Shared body size for steps, assertions, global rules, and variable values.
const storyBodyTextClass = "text-[12px] leading-[16px] text-secondary";
// Variable names stay mono so they read as identifiers.
const storyVarNameClass = "font-mono text-[12px] leading-[16px]";
const storyVarValueClass = "text-[12px] leading-[16px]";

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

function isBlankVariable(row: { key: string; value: string }) {
  return row.key.trim() === "" && row.value.trim() === "";
}

function EditableVariables({
  draft,
  onChange,
  onChangeNow,
  onCommitCheckpoint,
  nameColors,
  keyInputRefs,
  valueInputRefs,
}: {
  draft: StoryEditDraft;
  onChange: (variables: StoryEditDraft["variables"]) => void;
  onChangeNow: (variables: StoryEditDraft["variables"]) => void;
  onCommitCheckpoint: () => void;
  nameColors: Record<string, string>;
  keyInputRefs: React.RefObject<(HTMLInputElement | null)[]>;
  valueInputRefs: React.RefObject<(HTMLInputElement | null)[]>;
}) {
  function updateVariable(
    index: number,
    patch: Partial<{ key: string; value: string }>,
  ) {
    const next = [...draft.variables];
    next[index] = { ...next[index], ...patch };
    onChange(next);
  }

  function handleVariableKeyDown(
    e: React.KeyboardEvent<HTMLInputElement>,
    index: number,
    field: "key" | "value",
  ) {
    if (isUndoShortcut(e.nativeEvent)) return;

    const row = draft.variables[index];
    const value = field === "key" ? row.key : row.value;
    const refs = field === "key" ? keyInputRefs : valueInputRefs;

    if (e.key === "Enter") {
      e.preventDefault();
      onChangeNow(insertRow(draft.variables, index, { key: "", value: "" }));
      focusInputAt(keyInputRefs, index + 1);
      return;
    }

    if (e.key === "Backspace" && value === "" && isBlankVariable(row) && draft.variables.length > 1) {
      e.preventDefault();
      onChangeNow(removeRow(draft.variables, index));
      focusInputAt(refs, Math.max(0, index - 1));
    }
  }

  return (
    <div className="flex flex-col">
      {draft.variables.map((v, i) => (
        <div
          key={i}
          className="flex items-center gap-1.5 py-0.5 min-w-0 rounded-control"
        >
          <input
            ref={(el) => {
              keyInputRefs.current[i] = el;
            }}
            aria-label={`Variable name ${i + 1}`}
            value={v.key}
            onChange={(e) => updateVariable(i, { key: e.target.value })}
            onKeyDown={(e) => handleVariableKeyDown(e, i, "key")}
            onBlur={onCommitCheckpoint}
            className={cn(
              storyEditInputClass,
              "w-[5.5rem] shrink-0 truncate",
              storyVarNameClass,
              nameColors[v.key] ?? "text-tertiary",
            )}
          />
          <input
            ref={(el) => {
              valueInputRefs.current[i] = el;
            }}
            aria-label={`Variable value ${v.key || i + 1}`}
            value={v.value}
            onChange={(e) => updateVariable(i, { value: e.target.value })}
            onKeyDown={(e) => handleVariableKeyDown(e, i, "value")}
            onBlur={onCommitCheckpoint}
            className={cn(
              storyEditInputClass,
              "min-w-0 flex-1 truncate text-secondary",
              storyVarValueClass,
            )}
          />
        </div>
      ))}
    </div>
  );
}

// Read-only variables: key on the left, value beside it, and a copy button
// that fades in on row hover. Secrets stay masked.
function ReadOnlyVariables({
  story,
  nameColors,
}: {
  story: StoryDetail;
  nameColors: Record<string, string>;
}) {
  return (
    <div className="flex flex-col">
      {story.variables.map((v) => {
        const key = stripCode(v.key);
        const value = stripCode(v.value);
        const show = !v.secret;
        return (
          <div
            key={v.key}
            className="group/var flex items-center gap-1.5 py-0.5 min-w-0 rounded-control transition-colors hover:bg-surface-hover"
          >
            <span
              className={cn(
                "w-[5.5rem] shrink-0 truncate",
                storyVarNameClass,
                nameColors[key] ?? "text-tertiary",
              )}
            >
              {key}
            </span>
            <span
              className={cn(
                "min-w-0 flex-1 truncate",
                storyVarValueClass,
                value ? "text-secondary" : "text-quaternary",
              )}
            >
              {value ? (show ? value : "••••••") : "empty"}
            </span>
            <span className="shrink-0 opacity-0 transition-opacity group-hover/var:opacity-100">
              <CopyButton value={value} label={`Copy ${key}`} />
            </span>
          </div>
        );
      })}
    </div>
  );
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
          <div className="content-card">
            <div className="content-card-header">
              <Text variant="small-strong" color="secondary">
                Steps
              </Text>
            </div>
            <div className="content-card-body">
              <div className="story-loading-shell-lines" aria-hidden>
                <span />
                <span />
                <span />
              </div>
            </div>
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}

export function StoryView() {
  const { name } = useParams({ from: "/story/$name" });
  const search = useSearch({ from: "/story/$name" });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const registerRun = useRegisterRun();
  const [isStarting, setIsStarting] = React.useState(false);
  const [editingStoryName, setEditingStoryName] = React.useState<string | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isDuplicating, setIsDuplicating] = React.useState(false);
  // After Cancel, the remounted Edit button sits under the cursor and would
  // immediately pick up :hover — suppress pointer events until the mouse moves.
  const [suppressToolbarHover, setSuppressToolbarHover] = React.useState(false);
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
  const autoEditedStoryRef = React.useRef<string | null>(null);

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

  React.useEffect(() => {
    if (!search.edit || !storyReady || !story) return;
    if (autoEditedStoryRef.current === story.name) return;
    autoEditedStoryRef.current = story.name;
    beginEdit(storyToDraft(story));
    setEditingStoryName(story.name);
    requestAnimationFrame(() => stepInputRefs.current[0]?.focus());
    navigate({
      to: "/story/$name",
      params: { name: story.name },
      search: {},
      replace: true,
    });
  }, [search.edit, storyReady, story, beginEdit, navigate]);

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

  function updateDraftGlobalRules(globalRules: string, immediate = false) {
    const apply = immediate ? setDraftNow : setDraft;
    apply((prev) => ({ ...prev, globalRules }));
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
      const { runId, agentProvider, agentModel, variableOverrides } =
        await runStart(story.name);
      registerRun(runId, story.name, story.title, {
        agentProvider,
        agentModel,
        variableOverrides,
      });
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
    setSuppressToolbarHover(true);
    setEditingStoryName(null);
    clearEdit();
  }

  React.useEffect(() => {
    if (!suppressToolbarHover) return;
    const clear = () => setSuppressToolbarHover(false);
    window.addEventListener("pointermove", clear, { once: true });
    return () => window.removeEventListener("pointermove", clear);
  }, [suppressToolbarHover]);

  async function handleDuplicate() {
    if (!story || isDuplicating) return;
    setIsDuplicating(true);
    try {
      const duplicatedTitle = `${story.title} (Copy)`;
      const duplicated = await storiesDuplicate(story.name, duplicatedTitle);
      queryClient.setQueryData(["stories:get", duplicated.name], duplicated);
      // Optimistically insert so the sidebar can select the copy immediately.
      queryClient.setQueryData<StorySummary[]>(["stories:list"], (prev) => {
        if (!prev) return prev;
        if (prev.some((s) => s.name === duplicated.name)) return prev;
        const summary: StorySummary = {
          name: duplicated.name,
          title: duplicated.title,
          baseUrl: duplicated.baseUrl,
          createdAt: duplicated.createdAt,
          lastRun: duplicated.lastRun ?? null,
          siteSlug: duplicated.siteSlug,
          storyId: duplicated.storyId,
          mode: duplicated.mode,
        };
        return [summary, ...prev];
      });
      void queryClient.invalidateQueries({ queryKey: ["stories:list"] });
      navigate({ to: "/story/$name", params: { name: duplicated.name } });
    } catch (err) {
      reportAppErrorFromUnknown("Failed to duplicate story", err);
    } finally {
      setIsDuplicating(false);
    }
  }

  function handleRecordAgain() {
    if (!story) return;
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
            <ToolbarActions
              className={cn(
                "detail-view-toolbar-actions",
                suppressToolbarHover && "pointer-events-none",
              )}
            >
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
                  <Button
                    variant="glass"
                    size="titlebar"
                    radius="full"
                    onClick={handleEdit}
                  >
                    <PencilIcon className="size-4" />
                    Edit
                  </Button>
                  <Button
                    variant="glass"
                    size="titlebar"
                    radius="full"
                    onClick={handleRecordAgain}
                  >
                    <CircleDotIcon className="size-4" />
                    Record again
                  </Button>
                  <Button
                    variant="glass"
                    size="titlebar"
                    radius="full"
                    onClick={handleDuplicate}
                    disabled={isDuplicating}
                  >
                    {isDuplicating ? (
                      <Loader2Icon className="size-4 animate-spin" />
                    ) : (
                      <CopyIcon className="size-4" />
                    )}
                    Duplicate
                  </Button>
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
      {/* Two-column detail: steps on the left; variables + assertions on the
          right rail card (matches run view layout and typography). */}
      <div className="detail-view story-detail-view">
        <div className="detail-view-main story-sections">
          {(isEditingThisStory && draft) || story.steps.length > 0 ? (
            <div className="content-card">
              <div className="content-card-header">
                <div className="flex min-w-0 items-center gap-2">
                  <Text variant="small-strong" color="secondary">
                    Steps
                  </Text>
                  <Text variant="small" color="tertiary">
                    {(isEditingThisStory && draft ? draft.steps : story.steps).length}
                  </Text>
                </div>
              </div>
              <div className="content-card-body">
                <ol className="flex flex-col">
                  {(isEditingThisStory && draft ? draft.steps : story.steps).map((step, i) => (
                    <li
                      key={i}
                      className={cn(
                        "story-step-row",
                        isEditingThisStory && "story-step-row--editable",
                      )}
                    >
                      <span className="story-step-num">{i + 1}</span>
                      {isEditingThisStory && draft ? (
                        <input
                          ref={(el) => {
                            stepInputRefs.current[i] = el;
                          }}
                          aria-label={`Step ${i + 1}`}
                          value={step}
                          onChange={(e) =>
                            updateTextRow(
                              i,
                              e.target.value,
                              draft.steps,
                              (steps) => updateDraftSteps(steps),
                            )
                          }
                          onBlur={commitCheckpoint}
                          onKeyDown={(e) =>
                            handleTextRowKeyDown(
                              e,
                              i,
                              step,
                              draft.steps,
                              (steps, immediate) => updateDraftSteps(steps, immediate),
                              stepInputRefs,
                            )
                          }
                          className={cn(storyEditInputClass, storyBodyTextClass)}
                        />
                      ) : (
                        <Text variant="small" color="secondary">
                          <InlineCode text={step} colorMap={varColors.chip} />
                        </Text>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          ) : (
            <EmptyState placement="inline" title="No steps yet." />
          )}
        </div>

        {((isEditingThisStory && draft) ||
          story.variables.length > 0 ||
          story.assertions.length > 0 ||
          story.globalRules.trim().length > 0) && (
          <div className="detail-rail detail-rail--card">
            {(isEditingThisStory && draft) || story.variables.length > 0 ? (
              <Section title="Variables">
                {isEditingThisStory && draft ? (
                  <EditableVariables
                    draft={draft}
                    nameColors={varColors.text}
                    keyInputRefs={variableKeyInputRefs}
                    valueInputRefs={variableValueInputRefs}
                    onChange={(variables) => updateDraftVariables(variables)}
                    onChangeNow={(variables) => updateDraftVariables(variables, true)}
                    onCommitCheckpoint={commitCheckpoint}
                  />
                ) : (
                  <ReadOnlyVariables story={story} nameColors={varColors.text} />
                )}
              </Section>
            ) : null}

            {(isEditingThisStory && draft) || story.assertions.length > 0 ? (
              <Section title="Assertions">
                <div className="flex flex-col">
                  {(isEditingThisStory && draft ? draft.assertions : story.assertions).map(
                    (assertion, i) =>
                      isEditingThisStory && draft ? (
                        <div key={i} className="flex items-center gap-1.5 py-0.5 min-w-0">
                          <input
                            ref={(el) => {
                              assertionInputRefs.current[i] = el;
                            }}
                            aria-label={`Assertion ${i + 1}`}
                            value={assertion}
                            onChange={(e) =>
                              updateTextRow(
                                i,
                                e.target.value,
                                draft.assertions,
                                (assertions) => updateDraftAssertions(assertions),
                              )
                            }
                            onBlur={commitCheckpoint}
                            onKeyDown={(e) =>
                              handleTextRowKeyDown(
                                e,
                                i,
                                assertion,
                                draft.assertions,
                                (assertions, immediate) =>
                                  updateDraftAssertions(assertions, immediate),
                                assertionInputRefs,
                              )
                            }
                            className={cn(
                              storyEditInputClass,
                              storyBodyTextClass,
                            )}
                          />
                        </div>
                      ) : (
                        <RailAssertionLine
                          key={i}
                          text={assertion}
                          colorMap={varColors.chip}
                        />
                      ),
                  )}
                </div>
              </Section>
            ) : null}

            {(isEditingThisStory && draft) || story.globalRules.trim().length > 0 ? (
              <Section title="Global rules">
                {isEditingThisStory && draft ? (
                  <textarea
                    aria-label="Global rules"
                    value={draft.globalRules}
                    onChange={(e) => updateDraftGlobalRules(e.target.value)}
                    onBlur={commitCheckpoint}
                    placeholder="Mandatory rules the agent must follow (waits, failure conditions, etc.)"
                    rows={5}
                    className={cn(
                      "min-w-0 w-full bg-transparent border-0 outline-none p-0 focus:ring-1 focus:ring-field/60 rounded-sm",
                      storyBodyTextClass,
                      "story-global-rules-input resize-y min-h-[72px] max-h-[min(12rem,40vh)] overflow-y-auto",
                    )}
                  />
                ) : (
                  <div
                    className={cn(
                      "story-global-rules-preview whitespace-pre-wrap",
                      storyBodyTextClass,
                    )}
                  >
                    {story.globalRules}
                  </div>
                )}
              </Section>
            ) : null}
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
