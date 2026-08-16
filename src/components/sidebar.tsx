import * as React from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  PlusIcon,
  FolderPlusIcon,
  ArchiveIcon,
  SettingsIcon,
  Loader2Icon,
  SearchIcon,
  ChevronLeftIcon,
  BookOpenIcon,
  HistoryIcon,
  ClockIcon,
  BotIcon,
  CircleDotIcon,
  PencilLineIcon,
  ListChecksIcon,
} from "lucide-react";
import {
  Sidebar,
  SidebarFooter,
  SidebarList,
  SidebarRowGroup,
  SidebarListItem,
  SidebarListItemContent,
  SidebarListItemTitle,
  SidebarListGroupTitle,
  CollapsibleRoot,
  CollapsibleTrigger,
  CollapsibleContent,
  CollapsibleChevron,
  Button,
  Text,
  Toolbar,
  ToolbarRow,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
  Input,
  Field,
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
import { MacTitlebarRow } from "./mac-traffic-lights";
import { CommandSearch, useCommandSearchShortcut } from "./command-search";
import { SidebarUpdateStatus } from "./update-status";
import { cn } from "@/lib/utils";
import { reportAppErrorFromUnknown } from "@/lib/app-error";
import type {
  StorySummary,
  StoryDetail,
  RunResult,
} from "../lib/contract-types";
import {
  storiesList,
  storiesGet,
  storiesCreate,
  onStoriesChanged,
  storiesDelete,
  runsList,
  storiesRename,
  schedulesList,
  onSchedulesChanged,
  settingsGet,
} from "../lib/ipc";
import { useActiveRunMap, useAllRuns } from "../lib/run-store";
import {
  useSections,
  DEFAULT_SECTION_ID,
  type StorySection,
} from "../lib/sections-store";
import { usePersistedExpand } from "../lib/use-persisted-expand";

// Sections / Runs show this many rows at first, revealing another page per "Show more".
const PAGE_SIZE = 7;

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
// `persistKey` keeps the visible page depth across tab switches and restarts.
function ExpandableRows<T>({
  items,
  renderItem,
  persistKey,
}: {
  items: T[];
  renderItem: (item: T) => React.ReactNode;
  persistKey: string;
}) {
  const [visible, setVisible] = usePersistedExpand(persistKey, PAGE_SIZE);
  const shown = items.slice(0, visible);
  const remaining = items.length - shown.length;
  const canShowMore = remaining > 0;
  const canShowLess = visible > PAGE_SIZE;
  return (
    <>
      <SidebarRowGroup>
        {shown.map(renderItem)}
      </SidebarRowGroup>
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

// Status is no longer shown as sidebar pills on story rows — live runs use a spinner.

// Compact relative time — no "ago" suffix ("6m", "1h", "2d"), "now" for <1m.
function formatRelative(epochMs: number): string | undefined {
  if (!Number.isFinite(epochMs) || epochMs <= 0) return undefined;
  const secs = Math.floor((Date.now() - epochMs) / 1000);
  if (secs < 60) return "now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (!Number.isFinite(days)) return undefined;
  return `${days}d`;
}

// Re-render relative timestamps periodically so "now" advances to "1m", etc.
function useRelativeTimeTick(intervalMs = 30_000): void {
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
}

// Remove confirmation title with the item name in accent color.
function removeConfirmTitle(itemName: string) {
  return (
    <>
      Remove <span className="text-accent">{itemName}</span>?
    </>
  );
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
  confirmTitle: React.ReactNode;
  confirmDescription: string;
  confirmLabel: string;
  onConfirm: () => void;
}) {
  return (
    <span className="relative col-start-3 flex h-5 w-11 shrink-0 items-center justify-end justify-self-end">
      {isRunning ? (
        <Loader2Icon className="size-3.5 shrink-0 animate-spin text-accent" />
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
  leading = false,
  children,
}: {
  title: React.ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contextMenu?: React.ReactNode;
  /** First section in the list — top gap comes from the tab panel pt-4. */
  leading?: boolean;
  children: React.ReactNode;
}) {
  const header = (
    // px-2 on the trigger + no left margin on the title makes the section
    // header text start at the same x as the story rows (which sit at the
    // SidebarListItem button's px-2), so items are left-aligned with the
    // section label.
    <CollapsibleTrigger
      variant="section"
      className={cn(
        "flex w-full items-center gap-2 px-2",
        leading ? "pt-0" : "pt-2",
      )}
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
      className="mt-2 first:mt-0"
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
  onPrefetch,
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
  onPrefetch?: () => void;
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
        <div className="group/row w-full" onPointerEnter={onPrefetch}>
          {/* Single-row story: no leading icon — status reads from a pill, and
              the right-side accessory shows the relative creation time at rest and
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
                !isRunning ? formatRelative(story.createdAt) : undefined
              }
              archiveTitle="Remove story"
              confirmTitle={removeConfirmTitle(story.title)}
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

// ---------- generic single-field name dialog (sections + story rename) ----------
function NameDialog({
  open,
  title,
  description,
  fieldLabel,
  confirmLabel,
  placeholder,
  initialName,
  onSubmit,
  onOpenChange,
}: {
  open: boolean;
  title: string;
  description?: string;
  fieldLabel?: string;
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
      description={description}
      fieldLabel={fieldLabel}
      size="medium"
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

function CreateStoryDialog({
  open,
  onOpenChange,
  onRecord,
  onGenerate,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRecord: () => void;
  onGenerate: () => void;
  onCreated: (story: StoryDetail) => void;
}) {
  const [view, setView] = React.useState<"choose" | "manual">("choose");
  const [title, setTitle] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [isCreating, setIsCreating] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setView("choose");
    setTitle("");
    settingsGet()
      .then((settings) => setUrl(settings.startingUrl))
      .catch(() => setUrl(""));
  }, [open]);

  async function handleCreateManualStory() {
    if (!title.trim() || isCreating) return;
    setIsCreating(true);
    try {
      const story = await storiesCreate(title.trim(), url.trim() || "about:blank");
      onOpenChange(false);
      onCreated(story);
    } catch (err) {
      reportAppErrorFromUnknown("Failed to create story", err);
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="medium">
        <DialogHeader>
          <DialogTitle>{view === "choose" ? "New Story" : "Add Story Manually"}</DialogTitle>
          <DialogDescription>
            {view === "choose"
              ? "Record browser actions, start from an editable template, or generate with AI."
              : "Create a template story, then edit its steps, variables, and assertions."}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {view === "choose" ? (
            <div className="flex flex-col gap-2">
              <Button
                variant="filled"
                className="h-auto items-center justify-start gap-3 p-3 text-left"
                onClick={onRecord}
              >
                <span className="flex size-4 shrink-0 items-center justify-center">
                  <CircleDotIcon className="size-4" />
                </span>
                <span className="leading-4">Record story</span>
              </Button>
              <Button
                variant="filled"
                className="h-auto items-center justify-start gap-3 p-3 text-left"
                onClick={() => setView("manual")}
              >
                <span className="flex size-4 shrink-0 items-center justify-center">
                  <PencilLineIcon className="size-4" />
                </span>
                <span className="leading-4">Add manually</span>
              </Button>
              <Button
                variant="filled"
                className="h-auto items-center justify-start gap-3 p-3 text-left"
                onClick={onGenerate}
              >
                <span className="flex size-4 shrink-0 items-center justify-center">
                  <BotIcon className="size-4" />
                </span>
                <span className="leading-4">Generate</span>
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Field label="Story name" orientation="vertical">
                <Input
                  autoFocus
                  placeholder="e.g. Create gift card"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleCreateManualStory();
                    }
                  }}
                  disabled={isCreating}
                />
              </Field>
            </div>
          )}
        </DialogBody>
        {view === "manual" ? (
          <DialogFooter>
            <Button variant="filled" onClick={() => setView("choose")} disabled={isCreating}>
              Back
            </Button>
            <Button
              variant="accent"
              onClick={() => void handleCreateManualStory()}
              disabled={!title.trim() || isCreating}
            >
              {isCreating ? <Loader2Icon className="size-4 animate-spin" /> : null}
              Create Story
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

// Dialog kinds — a SINGLE NameDialog instance handles all three (two mounted
// Dialog roots could leave a lingering focus scope that made the New Section
// dialog open unreliably).
type DialogKind = "section-create" | "section-rename" | "story-rename";

type LibraryTab = "stories" | "bulk";

const DIALOG_META: Record<
  DialogKind,
  {
    title: string;
    confirmLabel: string;
    placeholder: string;
    description: string;
    fieldLabel: string;
  }
> = {
  "section-create": {
    title: "New Section",
    confirmLabel: "Create",
    placeholder: "Section name",
    description: "Group related stories together in the sidebar.",
    fieldLabel: "Section name",
  },
  "section-rename": {
    title: "Rename Section",
    confirmLabel: "Rename",
    placeholder: "Section name",
    description: "Change how this section appears in the sidebar.",
    fieldLabel: "Section name",
  },
  "story-rename": {
    title: "Rename Story",
    confirmLabel: "Rename",
    placeholder: "Story name",
    description: "Change how this story appears in the sidebar.",
    fieldLabel: "Story name",
  },
};

// System actions — History / Scheduled open their own main-pane pages; Search
// opens the command palette. Discrete Apple/Claude-style icon + label rows.
function SystemActions({
  active,
  onHistory,
  onScheduled,
  onSearch,
}: {
  active: "history" | "scheduled" | null;
  onHistory: () => void;
  onScheduled: () => void;
  onSearch: () => void;
}) {
  const actions = [
    {
      id: "history" as const,
      label: "History",
      icon: HistoryIcon,
      onClick: onHistory,
    },
    {
      id: "scheduled" as const,
      label: "Scheduled",
      icon: ClockIcon,
      onClick: onScheduled,
    },
    {
      id: "search" as const,
      label: "Search",
      icon: SearchIcon,
      onClick: onSearch,
      hint: "⌘K",
    },
  ];

  return (
    <nav className="system-actions" aria-label="System">
      {actions.map((action) => {
        const Icon = action.icon;
        const isActive = action.id !== "search" && active === action.id;
        return (
          <button
            key={action.id}
            type="button"
            aria-label={action.label}
            aria-current={isActive ? "page" : undefined}
            data-active={isActive}
            className="system-action-row"
            onClick={(e) => {
              e.currentTarget.blur();
              action.onClick();
            }}
          >
            <Icon className="system-action-row-icon size-3.5 shrink-0" />
            <span className="system-action-row-label">{action.label}</span>
            {action.hint ? (
              <span className="system-action-row-hint">{action.hint}</span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}

// Stories | Bulk library tabs with a single Plus dropdown (New story / New section).
function LibraryTabs({
  value,
  onChange,
  onNewStory,
  onNewSection,
}: {
  value: LibraryTab;
  onChange: (value: LibraryTab) => void;
  onNewStory: () => void;
  onNewSection: () => void;
}) {
  const options = [
    { value: "stories" as const, label: "Stories", icon: BookOpenIcon },
    { value: "bulk" as const, label: "Bulk", icon: ListChecksIcon },
  ];
  const activeIndex = value === "stories" ? 0 : 1;

  return (
    <div className="library-tabs-row">
      <div
        className="segment-control segment-control--labeled segment-control--library"
        role="tablist"
        aria-label="Library"
        data-active-index={activeIndex}
        style={
          {
            "--segment-active-index": String(activeIndex),
          } as React.CSSProperties
        }
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
              data-active={active}
              onClick={() => onChange(opt.value)}
            >
              <Icon className="size-3.5" />
              <span>{opt.label}</span>
            </button>
          );
        })}
      </div>

      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger asChild>
          <Button
            variant="transparent"
            size="titlebar"
            iconOnly
            className="library-plus-trigger"
            aria-label="New"
          >
            <PlusIcon className="size-3.5" />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className="library-plus-menu z-50 min-w-[10.5rem] rounded-control border border-separator bg-popover p-1 shadow-lg"
            align="end"
            sideOffset={6}
          >
            <DropdownMenu.Item
              className="flex cursor-pointer items-center gap-2 rounded-control px-2 py-1.5 text-small text-primary outline-none data-[highlighted]:bg-surface-hover"
              onSelect={onNewStory}
            >
              <CircleDotIcon className="size-3.5 text-secondary" />
              New story
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className="flex cursor-pointer items-center gap-2 rounded-control px-2 py-1.5 text-small text-primary outline-none data-[highlighted]:bg-surface-hover"
              onSelect={onNewSection}
            >
              <FolderPlusIcon className="size-3.5 text-secondary" />
              New section
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}

export function AppSidebar() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  useRelativeTimeTick();

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
        liveRunId: routeId === "/run/$runId" ? params.runId : undefined,
        onHistoryRoute:
          routeId === "/history" || routeId === "/history/$runId",
        onScheduledRoute:
          routeId === "/scheduled" || routeId === "/scheduled/$id",
        onBulkRoute: routeId === "/bulk-run",
        onStoriesHomeRoute: routeId === "/" || routeId === "/stories",
        onGenerateRoute:
          routeId === "/generate" ||
          routeId === "/generate/$conversationId",
      };
    },
  });

  const activeRuns = useActiveRunMap();
  const allRuns = useAllRuns();
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

  // Library tabs: Stories list vs Bulk runner. History / Scheduled / Search are
  // system actions (own pages / command palette), not tabs.
  const [tab, setTab] = React.useState<LibraryTab>(
    activeSelection.onBulkRoute ? "bulk" : "stories",
  );
  const [commandSearchOpen, setCommandSearchOpen] = React.useState(false);
  const [createStoryOpen, setCreateStoryOpen] = React.useState(false);

  const openCommandSearch = React.useCallback(() => {
    setCommandSearchOpen(true);
  }, []);

  useCommandSearchShortcut(openCommandSearch);

  React.useEffect(() => {
    if (activeSelection.onBulkRoute) {
      setTab("bulk");
    } else if (
      activeSelection.onStoriesHomeRoute ||
      activeSelection.storyName ||
      activeSelection.onGenerateRoute
    ) {
      setTab("stories");
    }
  }, [
    activeSelection.storyName,
    activeSelection.onStoriesHomeRoute,
    activeSelection.onBulkRoute,
    activeSelection.onGenerateRoute,
  ]);

  const systemActive: "history" | "scheduled" | null =
    activeSelection.onHistoryRoute || activeSelection.liveRunId
      ? "history"
      : activeSelection.onScheduledRoute
        ? "scheduled"
        : null;

  function handleLibraryTabChange(next: LibraryTab) {
    setTab(next);
    if (next === "bulk") {
      navigate({ to: "/bulk-run" });
      return;
    }
    if (
      activeSelection.onBulkRoute ||
      activeSelection.onScheduledRoute ||
      activeSelection.onHistoryRoute ||
      activeSelection.onGenerateRoute
    ) {
      if (stories.length > 0) {
        navigate({ to: "/story/$name", params: { name: stories[0].name } });
      } else {
        navigate({ to: "/stories" });
      }
    }
  }

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

  const schedulesQuery = useQuery({
    queryKey: ["schedules:list"],
    queryFn: schedulesList,
  });

  const prefetchStory = React.useCallback(
    (storyName: string) => {
      void queryClient.prefetchQuery({
        queryKey: ["stories:get", storyName],
        queryFn: () => storiesGet(storyName),
        staleTime: 30_000,
      });
    },
    [queryClient],
  );

  React.useEffect(() => {
    const unsub = onSchedulesChanged((updated) => {
      queryClient.setQueryData(["schedules:list"], updated);
    });
    return unsub;
  }, [queryClient]);

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

  type SidebarRunRow = RunResult & { isRunning?: boolean; isQueued?: boolean };

  const recentRuns = React.useMemo((): SidebarRunRow[] => {
    const history = runsQuery.data ?? [];
    const activeInStore = Object.values(allRuns).filter((r) => r.result === null);
    const activeIds = new Set(activeInStore.map((r) => r.runId));

    const activeRows: SidebarRunRow[] = activeInStore.map((r) => ({
      runId: r.runId,
      storyName: r.storyName,
      storyTitle: r.storyTitle || "Running story",
      status: "passed",
      summary: "",
      assertions: [],
      startedAt: r.startedAt,
      finishedAt: r.startedAt,
      isRunning: !r.queued,
      isQueued: !!r.queued,
    }));

    const historyRows: SidebarRunRow[] = history
      .filter((r) => !activeIds.has(r.runId))
      .map((r) => ({ ...r, isRunning: false, isQueued: false }));

    return [...activeRows, ...historyRows].sort((a, b) => {
      const aLive = a.isRunning || a.isQueued;
      const bLive = b.isRunning || b.isQueued;
      const aTime = aLive ? a.startedAt : a.finishedAt;
      const bTime = bLive ? b.startedAt : b.finishedAt;
      return bTime - aTime;
    });
  }, [runsQuery.data, allRuns]);

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

  const schedules = React.useMemo(
    () => schedulesQuery.data ?? [],
    [schedulesQuery.data],
  );

  function openStory(story: StorySummary) {
    prefetchStory(story.name);
    navigate({ to: "/story/$name", params: { name: story.name } });
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
        .catch((err) =>
          reportAppErrorFromUnknown("Failed to rename story", err),
        );
    }
    setDialog((d) => ({ ...d, open: false }));
  }

  async function handleDeleteStory(name: string) {
    try {
      await storiesDelete(name);
    } catch (err) {
      reportAppErrorFromUnknown("Failed to delete story", err);
      return;
    }
    queryClient.removeQueries({ queryKey: ["stories:get", name] });
    const remaining = await queryClient.fetchQuery({
      queryKey: ["stories:list"],
      queryFn: storiesList,
    });
    if (remaining.length === 0) {
      queryClient.invalidateQueries({ queryKey: ["runs:list"] });
    }
    const viewingDeletedStory = activeSelection.storyName === name;
    const onStoryDetailRoute = Boolean(
      activeSelection.storyName ??
        activeSelection.historyRunId ??
        activeSelection.liveRunId,
    );
    if (viewingDeletedStory || (remaining.length === 0 && onStoryDetailRoute)) {
      navigate({ to: "/stories" });
    }
  }

  function renderStoryRow(story: StorySummary) {
    const runIdByName = activeRuns.get(story.name);
    const runByTitle = !runIdByName
      ? Object.values(allRuns).find(
          (r) =>
            r.result === null &&
            (r.storyName === story.name || r.storyTitle === story.title),
        )
      : undefined;
    const live = runIdByName
      ? allRuns[runIdByName]
      : runByTitle;
    const runId = runIdByName ?? runByTitle?.runId;
    const selected =
      activeSelection.storyName === story.name ||
      (!!runId && activeSelection.liveRunId === runId);
    return (
      <StoryRow
        key={story.name}
        story={story}
        selected={selected}
        isRunning={!!runId && !live?.queued}
        sections={sections}
        onOpen={() => openStory(story)}
        onPrefetch={() => prefetchStory(story.name)}
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

  // Window shortcuts: mod+N new story, shift+mod+N new section, shift+mod+R bulk.
  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === "KeyN" && !e.shiftKey) {
        e.preventDefault();
        setCreateStoryOpen(true);
      } else if (e.code === "KeyN" && e.shiftKey) {
        e.preventDefault();
        setDialog({ open: true, kind: "section-create", initialName: "" });
      } else if (e.code === "KeyR" && e.shiftKey) {
        e.preventDefault();
        setTab("bulk");
        navigate({ to: "/bulk-run" });
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate]);

  return (
    <Sidebar
      className="!p-0 [&>div]:rounded-none"
      // Bottom-right gear opens in-app settings (same as Cmd+,).
      footer={
        <SidebarFooter className="sidebar-footer-settings mt-auto">
          <SidebarUpdateStatus />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="transparent"
                size="titlebar"
                iconOnly
                className="sidebar-footer-gear ml-auto"
                onClick={(e) => {
                  e.currentTarget.blur();
                  navigate({ to: "/settings", search: { section: "agent" } });
                }}
                aria-label="Settings"
              >
                <SettingsIcon className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" shortcut={["mod", ","]} />
          </Tooltip>
        </SidebarFooter>
      }
      // Traffic lights, then Stories | Bulk tabs with a single Plus menu.
      toolbar={
        <Toolbar className="border-b-0 bg-surface-sidebar">
          <MacTitlebarRow />
          <ToolbarRow className="sidebar-actions-row h-auto min-h-0 pt-3 pb-0">
            <LibraryTabs
              value={tab}
              onChange={handleLibraryTabChange}
              onNewStory={() => setCreateStoryOpen(true)}
              onNewSection={() =>
                setDialog({
                  open: true,
                  kind: "section-create",
                  initialName: "",
                })
              }
            />
          </ToolbarRow>
        </Toolbar>
      }
    >
      <SidebarList className="pt-0 pb-1">
        <div className="px-2 pt-3">
          <SystemActions
            active={systemActive}
            onHistory={() => navigate({ to: "/history" })}
            onScheduled={() => navigate({ to: "/scheduled" })}
            onSearch={openCommandSearch}
          />
        </div>
        <div key={tab} className="tab-panel-in pt-3">
          {tab === "stories" ? (
            <StoriesTab
              hasStories={hasStories}
              sections={sections}
              collapsed={collapsed}
              setCollapsed={setCollapsed}
              bySection={bySection}
              unassigned={unassigned}
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
            <div className="px-3 py-6 text-center">
              <Text variant="small" color="tertiary">
                Select stories in the bulk runner.
              </Text>
            </div>
          )}
        </div>
      </SidebarList>

      <NameDialog
        open={dialog.open}
        title={dialogMeta.title}
        description={dialogMeta.description}
        fieldLabel={dialogMeta.fieldLabel}
        confirmLabel={dialogMeta.confirmLabel}
        placeholder={dialogMeta.placeholder}
        initialName={dialog.initialName}
        onSubmit={handleDialogSubmit}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
      />

      <CreateStoryDialog
        open={createStoryOpen}
        onOpenChange={setCreateStoryOpen}
        onRecord={() => {
          setCreateStoryOpen(false);
          navigate({ to: "/record" });
        }}
        onGenerate={() => {
          setCreateStoryOpen(false);
          navigate({ to: "/generate" });
        }}
        onCreated={(story) => {
          queryClient.setQueryData(["stories:get", story.name], story);
          queryClient.setQueryData<StorySummary[]>(["stories:list"], (current) =>
            current?.some((item) => item.name === story.name)
              ? current
              : [story, ...(current ?? [])],
          );
          void queryClient.invalidateQueries({ queryKey: ["stories:list"] });
          navigate({
            to: "/story/$name",
            params: { name: story.name },
            search: { edit: true },
          });
        }}
      />

      <CommandSearch
        open={commandSearchOpen}
        onOpenChange={setCommandSearchOpen}
        stories={stories}
        runs={recentRuns}
        schedules={schedules}
        onSelectStory={(storyName) => {
          const story = stories.find((s) => s.name === storyName);
          if (story) openStory(story);
        }}
        onSelectRun={(runId, running) =>
          navigate(
            running
              ? { to: "/run/$runId", params: { runId } }
              : { to: "/history/$runId", params: { runId } },
          )
        }
        onSelectSchedule={(scheduleId) =>
          navigate({ to: "/scheduled/$id", params: { id: scheduleId } })
        }
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
  renderStoryRow: (story: StorySummary) => React.ReactNode;
  onRenameSection: (section: StorySection) => void;
  onDeleteSection: (id: string) => void;
}) {
  let isFirstSection = true;

  return (
    <>
      {!hasStories && (
        <div className="px-3 py-6 text-center">
          <Text variant="small" color="tertiary">
            No stories yet.
          </Text>
        </div>
      )}

      {/* User-created sections (right-click header → Rename / Delete) */}
      {sections.map((section) => {
        const leading = isFirstSection;
        isFirstSection = false;
        return (
        <CollapsibleSection
          key={section.id}
          title={section.name}
          leading={leading}
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
            persistKey={`stories:${section.id}`}
            items={bySection.get(section.id) ?? []}
            renderItem={renderStoryRow}
          />
          {(bySection.get(section.id) ?? []).length === 0 && (
            <Text
              variant="small"
              color="quaternary"
              className="block px-3 py-1.5"
            >
              No stories yet.
            </Text>
          )}
        </CollapsibleSection>
        );
      })}

      {/* Default "Stories" group for unassigned stories */}
      {hasStories && (
        <CollapsibleSection
          title="Stories"
          leading={isFirstSection}
          open={!collapsed[DEFAULT_SECTION_ID]}
          onOpenChange={(o) => setCollapsed(DEFAULT_SECTION_ID, !o)}
        >
          <ExpandableRows
            persistKey={`stories:${DEFAULT_SECTION_ID}`}
            items={unassigned}
            renderItem={renderStoryRow}
          />
          {unassigned.length === 0 && (
            <Text
              variant="small"
              color="quaternary"
              className="block px-3 py-1.5"
            >
              No stories yet.
            </Text>
          )}
        </CollapsibleSection>
      )}
    </>
  );
}

