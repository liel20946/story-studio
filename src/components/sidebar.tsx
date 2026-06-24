import * as React from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  PlusIcon,
  FolderPlusIcon,
  ListChecksIcon,
  ArchiveIcon,
  SettingsIcon,
  Loader2Icon,
  SearchIcon,
  ChevronLeftIcon,
  BookOpenIcon,
  HistoryIcon,
} from "lucide-react";
import {
  Sidebar,
  SidebarFooter,
  SidebarList,
  SidebarListItem,
  SidebarListItemContent,
  SidebarListItemTitle,
  SidebarListGroupTitle,
  CollapsibleRoot,
  CollapsibleTrigger,
  CollapsibleContent,
  CollapsibleChevron,
  Button,
  Badge,
  Text,
  Toolbar,
  ToolbarRow,
  Dialog,
  Input,
  AlertDialog,
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import type { RunStatus, StorySummary, RunResult } from "../lib/contract-types";
import {
  storiesList,
  onStoriesChanged,
  storiesDelete,
  runsList,
  runsDelete,
  storiesRename,
} from "../lib/ipc";
import { useActiveRunMap } from "../lib/run-store";
import {
  useSections,
  DEFAULT_SECTION_ID,
  type StorySection,
} from "../lib/sections-store";

const RECENT_RUNS = 15;
// Sections show this many rows at first, revealing another page per "Show more".
const PAGE_SIZE = 5;

// A text-only expander control: no row-style background highlight, just the
// label brightening on hover (group-hover) like Codex's Show more / Show less.
function ExpanderButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group/exp rounded-control px-1 py-0.5 text-left transition-colors hover:bg-surface-hover"
    >
      <Text
        variant="mini"
        className="text-tertiary transition-colors duration-150 group-hover/exp:text-secondary"
      >
        {label}
      </Text>
    </button>
  );
}

// Caps a row list to PAGE_SIZE, revealing PAGE_SIZE more per "Show more" click.
// Once expanded, a "Show less" appears alongside (both shown together while more
// remain, like Codex); collapsing back hides "Show more" when nothing is hidden.
function ExpandableRows<T>({
  items,
  renderItem,
}: {
  items: T[];
  renderItem: (item: T) => React.ReactNode;
}) {
  const [visible, setVisible] = React.useState(PAGE_SIZE);
  const shown = items.slice(0, visible);
  const remaining = items.length - shown.length;
  const canShowMore = remaining > 0;
  const canShowLess = visible > PAGE_SIZE;
  return (
    <>
      {shown.map(renderItem)}
      {(canShowMore || canShowLess) && (
        // pl-2 lines the labels up with the row titles — story rows no longer
        // have a leading icon, so the title sits at the SidebarListItem's inset.
        <div className="flex items-center gap-4 py-1 pl-2 pr-2">
          {canShowMore && (
            <ExpanderButton
              label="Show more"
              onClick={() => setVisible((v) => v + PAGE_SIZE)}
            />
          )}
          {canShowLess && (
            <ExpanderButton
              label="Show less"
              onClick={() =>
                setVisible((v) => Math.max(PAGE_SIZE, v - PAGE_SIZE))
              }
            />
          )}
        </div>
      )}
    </>
  );
}

// Status is conveyed by a small pill (no leading row icons): Passed / Failed /
// Error / Cancelled, or a blue "Running" pill while a run is in flight.
function statusBadgeColor(
  status: RunStatus,
): "green" | "red" | "secondary" {
  switch (status) {
    case "passed":
      return "green";
    case "cancelled":
      return "secondary";
    default:
      return "red";
  }
}

function statusBadgeLabel(status: RunStatus): string {
  switch (status) {
    case "passed":
      return "Passed";
    case "failed":
      return "Failed";
    case "error":
      return "Error";
    case "cancelled":
      return "Cancelled";
  }
}

function StatusPill({
  status,
  running,
}: {
  status?: RunStatus | null;
  running?: boolean;
}) {
  if (running) {
    return (
      <Badge color="blue" size="xs">
        Running
      </Badge>
    );
  }
  if (!status) return null;
  return (
    <Badge color={statusBadgeColor(status)} size="xs">
      {statusBadgeLabel(status)}
    </Badge>
  );
}

// Compact relative time — no "ago" suffix ("6m", "1h", "2d"), "now" for <1m.
function formatRelative(epochMs: number): string {
  const secs = Math.floor((Date.now() - epochMs) / 1000);
  if (secs < 60) return "now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

// Shared trailing accessory: fixed-width slot; time and archive occupy the same
// space (opacity swap) so rows never shift on hover.
function RowAccessory({
  time,
  isRunning,
  archiveTitle,
  confirmTitle,
  confirmDescription,
  confirmLabel,
  onConfirm,
}: {
  time?: string;
  isRunning?: boolean;
  archiveTitle: string;
  confirmTitle: string;
  confirmDescription: string;
  confirmLabel: string;
  onConfirm: () => void;
}) {
  return (
    <span className="relative col-start-3 flex h-5 w-11 shrink-0 items-center justify-end justify-self-end">
      {isRunning ? (
        <Loader2Icon className="size-3.5 shrink-0 animate-spin text-support-blue" />
      ) : (
        <>
          {time ? (
            <span className="pointer-events-none absolute inset-0 flex items-center justify-end text-[10px] leading-none tabular-nums text-tertiary transition-opacity group-hover/row:opacity-0">
              {time}
            </span>
          ) : null}
          <span
            className={cn(
              "absolute inset-0 flex items-center justify-end transition-opacity",
              time
                ? "pointer-events-none opacity-0 group-hover/row:pointer-events-auto group-hover/row:opacity-100"
                : "pointer-events-none opacity-0 group-hover/row:pointer-events-auto group-hover/row:opacity-100",
            )}
          >
            <AlertDialog
              trigger={
                <button
                  type="button"
                  aria-label={archiveTitle}
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="flex items-center text-tertiary transition-colors hover:text-secondary"
                >
                  <ArchiveIcon className="size-3.5" />
                </button>
              }
              title={confirmTitle}
              description={confirmDescription}
              confirmLabel={confirmLabel}
              confirmVariant="destructive"
              onConfirm={onConfirm}
            />
          </span>
        </>
      )}
    </span>
  );
}

// ---------- collapsible section ----------
// Whole header row toggles (title + chevron). The chevron sits on the right,
// aligned with the title. An optional right-click context menu carries section
// actions (rename/delete) — no hover-revealed buttons.
function CollapsibleSection({
  title,
  open,
  onOpenChange,
  contextMenu,
  children,
}: {
  title: React.ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contextMenu?: React.ReactNode;
  children: React.ReactNode;
}) {
  const header = (
    // px-2 on the trigger + no left margin on the title makes the section
    // header text start at the same x as the story rows (which sit at the
    // SidebarListItem button's px-2), so items are left-aligned with the
    // section label.
    <CollapsibleTrigger
      variant="section"
      className="flex w-full items-center gap-2 px-2 pt-2"
    >
      <SidebarListGroupTitle className="ml-0 mb-0">
        {title}
      </SidebarListGroupTitle>
      <CollapsibleChevron className="ml-auto" />
    </CollapsibleTrigger>
  );

  return (
    <CollapsibleRoot
      open={open}
      onOpenChange={onOpenChange}
      className="mt-2.5 first:mt-0"
    >
      {contextMenu ? (
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div className="w-full">{header}</div>
          </ContextMenuTrigger>
          {contextMenu}
        </ContextMenu>
      ) : (
        header
      )}
      <CollapsibleContent>
        <div className="pb-1">{children}</div>
      </CollapsibleContent>
    </CollapsibleRoot>
  );
}

// ---------- one story row (hover-trash delete + right-click Rename/Move to) ----------
function StoryRow({
  story,
  selected,
  isRunning,
  sections,
  onOpen,
  onRename,
  onMove,
  onMoveToNew,
  onDelete,
}: {
  story: StorySummary;
  selected: boolean;
  isRunning: boolean;
  sections: StorySection[];
  onOpen: () => void;
  onRename: () => void;
  onMove: (sectionId: string | null) => void;
  onMoveToNew: () => void;
  onDelete: () => void;
}) {
  const [menuView, setMenuView] = React.useState<"main" | "move">("main");

  return (
    <ContextMenu
      onOpenChange={(open) => {
        if (!open) setMenuView("main");
      }}
    >
      {/* Wrapper carries the right-click trigger — SidebarListItem doesn't
          forward asChild props, and the popper needs a real anchor box. The
          NAMED hover group (`group/row`) scopes the hover reveal to THIS row
          only — an unnamed `group` collided with an ancestor `group` so every
          row's accessory revealed at once. */}
      <ContextMenuTrigger asChild>
        <div className="group/row w-full">
          {/* Single-row story: no leading icon — status reads from a pill, and
              the right-side accessory shows the relative time at rest and
              reveals a grey archive button on hover (time hides). */}
          <SidebarListItem
            selected={selected}
            onClick={onOpen}
            className={cn(!selected && "hover:bg-surface-hover")}
          >
            <SidebarListItemContent>
              <SidebarListItemTitle>{story.title}</SidebarListItemTitle>
            </SidebarListItemContent>
            {/* Story rows show only a spinning circle while running — no status
                pill at rest (status reads from the story/run views instead). The
                spinner lives inside RowAccessory's right-aligned slot so it lines
                up with the relative-time label rather than floating mid-row. */}
            <RowAccessory
              isRunning={isRunning}
              time={
                !isRunning && story.lastRun
                  ? formatRelative(story.lastRun.finishedAt)
                  : undefined
              }
              archiveTitle="Remove story"
              confirmTitle={`Remove "${story.title}"?`}
              confirmDescription="This story will be removed from your library. This cannot be undone."
              confirmLabel="Remove"
              onConfirm={onDelete}
            />
          </SidebarListItem>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {menuView === "main" ? (
          <>
            <ContextMenuItem onSelect={onRename}>Rename</ContextMenuItem>
            <ContextMenuItem
              onSelect={(e) => {
                e.preventDefault();
                setMenuView("move");
              }}
            >
              Move to
            </ContextMenuItem>
          </>
        ) : (
          <>
            <ContextMenuItem
              onSelect={(e) => {
                e.preventDefault();
                setMenuView("main");
              }}
            >
              <ChevronLeftIcon className="size-3.5 text-tertiary" />
              Back
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => onMove(null)}>Stories</ContextMenuItem>
            {sections.length > 0 && <ContextMenuSeparator />}
            {sections.map((s) => (
              <ContextMenuItem key={s.id} onSelect={() => onMove(s.id)}>
                {s.name}
              </ContextMenuItem>
            ))}
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={onMoveToNew}>New Section…</ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

// ---------- one history run row (title + fixed trailing time) ----------
function HistoryRunRow({
  run,
  selected,
  onOpen,
  onDelete,
}: {
  run: RunResult;
  selected: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="group/row w-full">
      <SidebarListItem
        selected={selected}
        onClick={onOpen}
        className={cn(!selected && "hover:bg-surface-hover")}
      >
        <SidebarListItemContent>
          <SidebarListItemTitle>{run.storyTitle}</SidebarListItemTitle>
        </SidebarListItemContent>
        {/* Fixed slot width keeps timestamps aligned; badges sit at the trailing
            edge of the slot so they sit closer to the relative-time column. */}
        <span className="col-start-2 flex w-[4.5rem] shrink-0 items-center justify-end self-center">
          <StatusPill status={run.status} />
        </span>
        <RowAccessory
          time={formatRelative(run.finishedAt)}
          archiveTitle="Remove run"
          confirmTitle="Remove this run?"
          confirmDescription="This run will be removed from history. This cannot be undone."
          confirmLabel="Remove"
          onConfirm={onDelete}
        />
      </SidebarListItem>
    </div>
  );
}

// ---------- generic single-field name dialog (sections + story rename) ----------
function NameDialog({
  open,
  title,
  confirmLabel,
  placeholder,
  initialName,
  onSubmit,
  onOpenChange,
}: {
  open: boolean;
  title: string;
  confirmLabel: string;
  placeholder: string;
  initialName: string;
  onSubmit: (name: string) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = React.useState(initialName);

  React.useEffect(() => {
    if (open) setName(initialName);
  }, [open, initialName]);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      confirmLabel={confirmLabel}
      confirmDisabled={!name.trim()}
      onConfirm={() => onSubmit(name.trim())}
    >
      <Input
        autoFocus
        value={name}
        placeholder={placeholder}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && name.trim()) {
            e.preventDefault();
            onSubmit(name.trim());
            onOpenChange(false);
          }
        }}
      />
    </Dialog>
  );
}

// Dialog kinds — a SINGLE NameDialog instance handles all three (two mounted
// Dialog roots could leave a lingering focus scope that made the New Section
// dialog open unreliably).
type DialogKind = "section-create" | "section-rename" | "story-rename";

const DIALOG_META: Record<
  DialogKind,
  { title: string; confirmLabel: string; placeholder: string }
> = {
  "section-create": {
    title: "New Section",
    confirmLabel: "Create",
    placeholder: "Section name",
  },
  "section-rename": {
    title: "Rename Section",
    confirmLabel: "Rename",
    placeholder: "Section name",
  },
  "story-rename": {
    title: "Rename Story",
    confirmLabel: "Rename",
    placeholder: "Story name",
  },
};

// ---------- Stories | Runs segment control (pill toggle, icon segments) ----------
function SegmentControl({
  value,
  onChange,
}: {
  value: "stories" | "runs";
  onChange: (value: "stories" | "runs") => void;
}) {
  const options = [
    { value: "stories" as const, label: "Stories", icon: BookOpenIcon },
    { value: "runs" as const, label: "Runs", icon: HistoryIcon },
  ];
  return (
    <div
      className="segment-control"
      role="tablist"
      aria-label="Sidebar view"
      data-active-index={value === "stories" ? 0 : 1}
    >
      <span className="segment-control-thumb" aria-hidden />
      {options.map((opt) => {
        const Icon = opt.icon;
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={opt.label}
            title={opt.label}
            data-active={active}
            onClick={() => onChange(opt.value)}
          >
            <Icon className="size-3.5" strokeWidth={1.75} />
          </button>
        );
      })}
    </div>
  );
}

export function AppSidebar() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Derive the selected row from the router's matched leaf route. Selecting
  // highlight reactive to navigation — previously a `matchRoute` call did not
  // re-render this component, so the highlight went stale until a manual
  // collapse/expand.
  const activeSelection = useRouterState({
    select: (s) => {
      const leaf = s.matches[s.matches.length - 1];
      const routeId = leaf?.routeId as string | undefined;
      const params = (leaf?.params ?? {}) as Record<string, string>;
      return {
        storyName: routeId === "/story/$name" ? params.name : undefined,
        historyRunId: routeId === "/history/$runId" ? params.runId : undefined,
        // A running story navigates to its live run view — track that runId so
        // the originating story row stays highlighted while it runs.
        liveRunId: routeId === "/run/$runId" ? params.runId : undefined,
      };
    },
  });

  const activeRuns = useActiveRunMap();
  const {
    sections,
    assignments,
    collapsed,
    createSection,
    renameSection,
    deleteSection,
    assignStory,
    setCollapsed,
  } = useSections();

  // Sidebar tab: reusable Stories vs past Runs. Initialised from the current
  // route (opening a history run lands on Runs) then switched manually.
  const [tab, setTab] = React.useState<"stories" | "runs">(
    activeSelection.historyRunId ? "runs" : "stories",
  );
  const [searchQuery, setSearchQuery] = React.useState("");

  React.useEffect(() => {
    if (activeSelection.historyRunId) {
      setTab("runs");
    }
  }, [activeSelection.historyRunId]);

  // One unified dialog state for section create/rename and story rename.
  const [dialog, setDialog] = React.useState<{
    open: boolean;
    kind: DialogKind;
    initialName: string;
    sectionId?: string;
    storyName?: string;
    pendingStory?: string;
  }>({ open: false, kind: "section-create", initialName: "" });

  const storiesQuery = useQuery({
    queryKey: ["stories:list"],
    queryFn: storiesList,
  });

  const runsQuery = useQuery({
    queryKey: ["runs:list"],
    queryFn: runsList,
  });

  React.useEffect(() => {
    const unsub = onStoriesChanged((updated) => {
      queryClient.setQueryData(["stories:list"], updated);
    });
    return unsub;
  }, [queryClient]);

  const stories = React.useMemo(
    () => storiesQuery.data ?? [],
    [storiesQuery.data],
  );
  const recentRuns: RunResult[] = (runsQuery.data ?? []).slice(0, RECENT_RUNS);

  // Group stories by section. Assignments pointing at a deleted section fall
  // back to the default "Stories" group.
  const { bySection, unassigned } = React.useMemo(() => {
    const ids = new Set(sections.map((s) => s.id));
    const grouped = new Map<string, StorySummary[]>();
    const rest: StorySummary[] = [];
    for (const story of stories) {
      const sid = assignments[story.name];
      if (sid && ids.has(sid)) {
        const arr = grouped.get(sid);
        if (arr) arr.push(story);
        else grouped.set(sid, [story]);
      } else {
        rest.push(story);
      }
    }
    return { bySection: grouped, unassigned: rest };
  }, [stories, sections, assignments]);

  const normalizedSearch = searchQuery.trim().toLowerCase();
  const matchesSearch = React.useCallback(
    (text: string) =>
      !normalizedSearch || text.toLowerCase().includes(normalizedSearch),
    [normalizedSearch],
  );

  const filteredUnassigned = React.useMemo(
    () =>
      unassigned.filter(
        (s) => matchesSearch(s.title) || matchesSearch(s.name),
      ),
    [unassigned, matchesSearch],
  );

  const filteredBySection = React.useMemo(() => {
    const next = new Map<string, StorySummary[]>();
    for (const [sectionId, sectionStories] of bySection) {
      const filtered = sectionStories.filter(
        (s) => matchesSearch(s.title) || matchesSearch(s.name),
      );
      if (filtered.length > 0) next.set(sectionId, filtered);
    }
    return next;
  }, [bySection, matchesSearch]);

  const filteredRuns = React.useMemo(
    () =>
      recentRuns.filter(
        (r) =>
          matchesSearch(r.storyTitle) || matchesSearch(r.storyName),
      ),
    [recentRuns, matchesSearch],
  );

  function openStory(story: StorySummary) {
    const runId = activeRuns.get(story.name);
    if (runId) {
      // Running → jump straight to its live run view (not the story detail).
      navigate({ to: "/run/$runId", params: { runId } });
    } else {
      navigate({ to: "/story/$name", params: { name: story.name } });
    }
  }

  function handleDialogSubmit(name: string) {
    if (dialog.kind === "section-create") {
      const id = createSection(name);
      if (dialog.pendingStory) assignStory(dialog.pendingStory, id);
    } else if (dialog.kind === "section-rename" && dialog.sectionId) {
      renameSection(dialog.sectionId, name);
    } else if (dialog.kind === "story-rename" && dialog.storyName) {
      const storyName = dialog.storyName;
      void storiesRename(storyName, name)
        .then((updated) => {
          queryClient.setQueryData(["stories:get", storyName], updated);
          queryClient.invalidateQueries({ queryKey: ["stories:list"] });
          // Run history rows show the story title — refresh them after rename.
          queryClient.invalidateQueries({ queryKey: ["runs:list"] });
        })
        .catch((err) => console.error("[Sidebar] stories:rename failed", err));
    }
    setDialog((d) => ({ ...d, open: false }));
  }

  async function handleDeleteRun(runId: string) {
    await runsDelete(runId);
    queryClient.invalidateQueries({ queryKey: ["runs:list"] });
    queryClient.invalidateQueries({ queryKey: ["stories:list"] });
  }

  async function handleDeleteStory(name: string) {
    try {
      await storiesDelete(name);
    } catch (err) {
      console.error("[Sidebar] stories:delete failed", err);
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["stories:list"] });
    if (activeSelection.storyName === name) navigate({ to: "/" });
  }

  function renderStoryRow(story: StorySummary) {
    const runId = activeRuns.get(story.name);
    const selected =
      activeSelection.storyName === story.name ||
      (!!runId && activeSelection.liveRunId === runId);
    return (
      <StoryRow
        key={story.name}
        story={story}
        selected={selected}
        isRunning={activeRuns.has(story.name)}
        sections={sections}
        onOpen={() => openStory(story)}
        onRename={() =>
          setDialog({
            open: true,
            kind: "story-rename",
            initialName: story.title,
            storyName: story.name,
          })
        }
        onMove={(sectionId) => assignStory(story.name, sectionId)}
        onMoveToNew={() =>
          setDialog({
            open: true,
            kind: "section-create",
            initialName: "",
            pendingStory: story.name,
          })
        }
        onDelete={() => handleDeleteStory(story.name)}
      />
    );
  }

  const hasStories = stories.length > 0;
  const dialogMeta = DIALOG_META[dialog.kind];

  // Window keyboard shortcuts for the toolbar actions: ⌘N records a story,
  // ⇧⌘N creates a section, ⇧⌘R opens bulk run. Keyed off e.code so they're
  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === "KeyN" && !e.shiftKey) {
        e.preventDefault();
        navigate({ to: "/record" });
      } else if (e.code === "KeyN" && e.shiftKey) {
        e.preventDefault();
        setDialog({ open: true, kind: "section-create", initialName: "" });
      } else if (e.code === "KeyR" && e.shiftKey) {
        if (!hasStories) return;
        e.preventDefault();
        navigate({ to: "/bulk-run" });
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate, hasStories]);

  return (
    <Sidebar
      className="!p-0 [&>div]:rounded-none"
      // Bottom-left gear opens in-app settings (same as Cmd+,).
      footer={
        <SidebarFooter className="sidebar-footer-settings mt-auto">
          <Button
            variant="transparent"
            size="small"
            iconOnly
            onClick={() => navigate({ to: "/settings", search: { section: "appearance" } })}
            aria-label="Settings"
          >
            <SettingsIcon className="size-4" />
          </Button>
        </SidebarFooter>
      }
      // Custom toolbar: traffic-light spacer, then toggle + actions on one row.
      toolbar={
        <Toolbar className="border-b-0 bg-surface-sidebar">
          <div className="drag-region sidebar-titlebar-spacer" aria-hidden />
          <ToolbarRow className="sidebar-actions-row h-auto min-h-0 pt-3 pb-1.5">
            <SegmentControl value={tab} onChange={setTab} />
            <div className="ml-auto flex items-center gap-0.5">
              {hasStories && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="transparent"
                      size="toolbar"
                      onClick={(e) => {
                        // Blur so the focus-triggered tooltip doesn't stay stuck
                        // open after navigating (the sidebar stays mounted).
                        e.currentTarget.blur();
                        navigate({ to: "/bulk-run" });
                      }}
                      aria-label="Run stories"
                    >
                      <ListChecksIcon className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent shortcut={["⇧", "⌘", "R"]}>
                    Run stories
                  </TooltipContent>
                </Tooltip>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="transparent"
                    size="toolbar"
                    onClick={(e) => {
                      e.currentTarget.blur();
                      setDialog({
                        open: true,
                        kind: "section-create",
                        initialName: "",
                      });
                    }}
                    aria-label="New section"
                  >
                    <FolderPlusIcon className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent shortcut={["⇧", "⌘", "N"]}>
                  New section
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="transparent"
                    size="toolbar"
                    onClick={(e) => {
                      e.currentTarget.blur();
                      navigate({ to: "/record" });
                    }}
                    aria-label="Record story"
                  >
                    <PlusIcon className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent shortcut={["⌘", "N"]}>
                  Record story
                </TooltipContent>
              </Tooltip>
            </div>
          </ToolbarRow>
          <ToolbarRow className="h-auto px-2 pb-2">
            <label className="sidebar-search w-full">
              <SearchIcon className="size-3.5 shrink-0 text-tertiary" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={tab === "stories" ? "Filter stories…" : "Filter runs…"}
                aria-label={tab === "stories" ? "Filter stories" : "Filter runs"}
              />
            </label>
          </ToolbarRow>
        </Toolbar>
      }
    >
      <SidebarList className="pt-2">
        {/* Keyed by `tab` so the panel re-mounts and replays the crossfade/slide
            animation on every Stories ↔ Runs toggle. */}
        <div key={tab} className="tab-panel-in">
          {tab === "stories" ? (
            <StoriesTab
              hasStories={hasStories}
              sections={sections}
              collapsed={collapsed}
              setCollapsed={setCollapsed}
              bySection={filteredBySection}
              unassigned={filteredUnassigned}
              searchActive={!!normalizedSearch}
              renderStoryRow={renderStoryRow}
              onRenameSection={(section) =>
                setDialog({
                  open: true,
                  kind: "section-rename",
                  sectionId: section.id,
                  initialName: section.name,
                })
              }
              onDeleteSection={deleteSection}
            />
          ) : (
            <RunsTab
              runs={filteredRuns}
              searchActive={!!normalizedSearch}
              activeRunId={activeSelection.historyRunId}
              onOpen={(runId) =>
                navigate({ to: "/history/$runId", params: { runId } })
              }
              onDelete={handleDeleteRun}
            />
          )}
        </div>
      </SidebarList>

      <NameDialog
        open={dialog.open}
        title={dialogMeta.title}
        confirmLabel={dialogMeta.confirmLabel}
        placeholder={dialogMeta.placeholder}
        initialName={dialog.initialName}
        onSubmit={handleDialogSubmit}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
      />
    </Sidebar>
  );
}

// ---------- Stories tab: user sections + the default "Stories" group ----------
function StoriesTab({
  hasStories,
  sections,
  collapsed,
  setCollapsed,
  bySection,
  unassigned,
  searchActive,
  renderStoryRow,
  onRenameSection,
  onDeleteSection,
}: {
  hasStories: boolean;
  sections: StorySection[];
  collapsed: Record<string, boolean>;
  setCollapsed: (id: string, value: boolean) => void;
  bySection: Map<string, StorySummary[]>;
  unassigned: StorySummary[];
  searchActive?: boolean;
  renderStoryRow: (story: StorySummary) => React.ReactNode;
  onRenameSection: (section: StorySection) => void;
  onDeleteSection: (id: string) => void;
}) {
  const hasVisibleStories =
    unassigned.length > 0 ||
    sections.some((s) => (bySection.get(s.id) ?? []).length > 0);

  return (
    <>
      {!hasStories && (
        <div className="px-3 py-6 text-center">
          <Text variant="small" color="tertiary">
            No stories yet.{"\n"}Click + to record one.
          </Text>
        </div>
      )}

      {hasStories && searchActive && !hasVisibleStories && (
        <div className="px-3 py-6 text-center">
          <Text variant="small" color="tertiary">
            No stories match your search.
          </Text>
        </div>
      )}

      {/* User-created sections (right-click header → Rename / Delete) */}
      {sections
        .filter((section) => (bySection.get(section.id) ?? []).length > 0 || !searchActive)
        .map((section) => (
        <CollapsibleSection
          key={section.id}
          title={section.name}
          open={!collapsed[section.id]}
          onOpenChange={(o) => setCollapsed(section.id, !o)}
          contextMenu={
            <ContextMenuContent>
              <ContextMenuItem onSelect={() => onRenameSection(section)}>
                Rename
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                color="red"
                onSelect={() => onDeleteSection(section.id)}
              >
                Delete Section
              </ContextMenuItem>
            </ContextMenuContent>
          }
        >
          <ExpandableRows
            items={bySection.get(section.id) ?? []}
            renderItem={renderStoryRow}
          />
          {(bySection.get(section.id) ?? []).length === 0 && (
            <Text
              variant="small"
              color="quaternary"
              className="block px-3 py-1.5"
            >
              No Stories.
            </Text>
          )}
        </CollapsibleSection>
      ))}

      {/* Default "Stories" group for unassigned stories */}
      {hasStories && (!searchActive || unassigned.length > 0) && (
        <CollapsibleSection
          title="Stories"
          open={!collapsed[DEFAULT_SECTION_ID]}
          onOpenChange={(o) => setCollapsed(DEFAULT_SECTION_ID, !o)}
        >
          <ExpandableRows items={unassigned} renderItem={renderStoryRow} />
          {unassigned.length === 0 && (
            <Text
              variant="small"
              color="quaternary"
              className="block px-3 py-1.5"
            >
              No Stories.
            </Text>
          )}
        </CollapsibleSection>
      )}
    </>
  );
}

// ---------- Runs tab: flat list of recent run history ----------
function RunsTab({
  runs,
  searchActive,
  activeRunId,
  onOpen,
  onDelete,
}: {
  runs: RunResult[];
  searchActive?: boolean;
  activeRunId?: string;
  onOpen: (runId: string) => void;
  onDelete: (runId: string) => void;
}) {
  if (runs.length === 0) {
    return (
      <div className="px-3 py-6 text-center">
        <Text variant="small" color="tertiary">
          {searchActive
            ? "No runs match your search."
            : "No runs yet.\nRun a story to see it here."}
        </Text>
      </div>
    );
  }
  return (
    <div className="pt-1">
      <ExpandableRows
        items={runs}
        renderItem={(run) => (
          <HistoryRunRow
            key={run.runId}
            run={run}
            selected={activeRunId === run.runId}
            onOpen={() => onOpen(run.runId)}
            onDelete={() => onDelete(run.runId)}
          />
        )}
      />
    </div>
  );
}
