import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  BookOpenIcon,
  BotIcon,
  ClockIcon,
  HistoryIcon,
  SearchIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  GenerateConversationSummary,
  RunResult,
  ScheduledRun,
  StorySummary,
} from "@/lib/contract-types";

type SearchItemKind = "story" | "run" | "schedule" | "conversation";

interface SearchItem {
  id: string;
  kind: SearchItemKind;
  title: string;
  subtitle?: string;
  meta?: string;
  running?: boolean;
}

interface SearchSection {
  id: SearchItemKind;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  items: SearchItem[];
}

const SECTION_META: Record<
  SearchItemKind,
  { label: string; icon: React.ComponentType<{ className?: string }> }
> = {
  story: { label: "Stories", icon: BookOpenIcon },
  run: { label: "Runs", icon: HistoryIcon },
  schedule: { label: "Schedules", icon: ClockIcon },
  conversation: { label: "Conversations", icon: BotIcon },
};

const EMPTY_PREVIEW_LIMIT = 5;
const SEARCH_RESULT_LIMIT = 8;

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

function matchesQuery(query: string, ...parts: Array<string | undefined>): boolean {
  if (!query) return true;
  const normalized = query.toLowerCase();
  return parts.some((part) => part?.toLowerCase().includes(normalized));
}

function buildSections({
  query,
  stories,
  runs,
  schedules,
  conversations,
}: {
  query: string;
  stories: StorySummary[];
  runs: Array<RunResult & { isRunning?: boolean }>;
  schedules: ScheduledRun[];
  conversations: GenerateConversationSummary[];
}): SearchSection[] {
  const normalized = query.trim().toLowerCase();
  const limit = normalized ? SEARCH_RESULT_LIMIT : EMPTY_PREVIEW_LIMIT;

  const storyItems: SearchItem[] = stories
    .filter((story) => matchesQuery(normalized, story.title, story.name, story.siteSlug))
    .slice(0, limit)
    .map((story) => ({
      id: story.name,
      kind: "story" as const,
      title: story.title,
      subtitle: story.siteSlug ?? story.name,
      meta: formatRelative(story.createdAt),
    }));

  const runItems: SearchItem[] = runs
    .filter((run) => matchesQuery(normalized, run.storyTitle, run.storyName))
    .slice(0, limit)
    .map((run) => ({
      id: run.runId,
      kind: "run" as const,
      title: run.storyTitle,
      subtitle: run.storyName,
      meta: run.isRunning
        ? "Running"
        : formatRelative(run.finishedAt ?? run.startedAt),
      running: run.isRunning,
    }));

  const scheduleItems: SearchItem[] = schedules
    .filter((schedule) =>
      matchesQuery(normalized, schedule.name, ...schedule.storyNames),
    )
    .slice(0, limit)
    .map((schedule) => ({
      id: schedule.id,
      kind: "schedule" as const,
      title: schedule.name,
      subtitle:
        schedule.storyNames.length > 0
          ? schedule.storyNames.join(", ")
          : undefined,
      meta: schedule.lastRunAt
        ? formatRelative(schedule.lastRunAt)
        : formatRelative(schedule.scheduledAt),
    }));

  const conversationItems: SearchItem[] = conversations
    .filter((conversation) => matchesQuery(normalized, conversation.title))
    .slice(0, limit)
    .map((conversation) => ({
      id: conversation.id,
      kind: "conversation" as const,
      title: conversation.title,
      meta: conversation.generating
        ? "Generating"
        : formatRelative(conversation.updatedAt),
      running: conversation.generating,
    }));

  return (["story", "run", "schedule", "conversation"] as const)
    .map((kind) => {
      const items =
        kind === "story"
          ? storyItems
          : kind === "run"
            ? runItems
            : kind === "schedule"
              ? scheduleItems
              : conversationItems;
      const meta = SECTION_META[kind];
      return {
        id: kind,
        label: meta.label,
        icon: meta.icon,
        items,
      };
    })
    .filter((section) => section.items.length > 0);
}

export function CommandSearch({
  open,
  onOpenChange,
  stories,
  runs,
  schedules,
  conversations,
  onSelectStory,
  onSelectRun,
  onSelectSchedule,
  onSelectConversation,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stories: StorySummary[];
  runs: Array<RunResult & { isRunning?: boolean }>;
  schedules: ScheduledRun[];
  conversations: GenerateConversationSummary[];
  onSelectStory: (storyName: string) => void;
  onSelectRun: (runId: string, running: boolean) => void;
  onSelectSchedule: (scheduleId: string) => void;
  onSelectConversation: (conversationId: string) => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const [query, setQuery] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(0);

  const sections = React.useMemo(
    () =>
      buildSections({
        query,
        stories,
        runs,
        schedules,
        conversations,
      }),
    [query, stories, runs, schedules, conversations],
  );

  const flatItems = React.useMemo(
    () => sections.flatMap((section) => section.items),
    [sections],
  );

  React.useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveIndex(0);
      return;
    }
    const id = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [open]);

  React.useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  React.useEffect(() => {
    if (!open || flatItems.length === 0) return;
    const activeEl = listRef.current?.querySelector<HTMLElement>(
      `[data-command-index="${activeIndex}"]`,
    );
    activeEl?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, flatItems.length, open]);

  function activateItem(item: SearchItem) {
    onOpenChange(false);
    switch (item.kind) {
      case "story":
        onSelectStory(item.id);
        break;
      case "run":
        onSelectRun(item.id, !!item.running);
        break;
      case "schedule":
        onSelectSchedule(item.id);
        break;
      case "conversation":
        onSelectConversation(item.id);
        break;
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (flatItems.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((index) => (index + 1) % flatItems.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((index) => (index - 1 + flatItems.length) % flatItems.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = flatItems[activeIndex];
      if (item) activateItem(item);
    }
  }

  let itemIndex = -1;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal container={document.body}>
        <DialogPrimitive.Overlay className="command-search-overlay fixed inset-0 z-[120]" />
        <DialogPrimitive.Content
          className="command-search-panel fixed left-1/2 top-[18%] z-[121] flex w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 flex-col overflow-hidden rounded-[14px] border border-separator bg-popover shadow-2xl outline-none"
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <div className="command-search-input-row flex items-center gap-2 border-b border-separator px-3 py-2.5">
            <SearchIcon className="size-3.5 shrink-0 text-tertiary" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search stories, runs, schedules, and conversations"
              aria-label="Search"
              className="min-w-0 flex-1 border-none bg-transparent text-small text-primary outline-none placeholder:text-tertiary"
            />
          </div>

          <div ref={listRef} className="command-search-results max-h-[min(420px,50vh)] overflow-y-auto p-1">
            {flatItems.length === 0 ? (
              <div className="px-3 py-6 text-center text-small text-tertiary">
                {query.trim()
                  ? "No results match your search."
                  : "Nothing to search yet."}
              </div>
            ) : (
              sections.map((section) => (
                  <div key={section.id} className="pb-0.5">
                    <div className="px-2 pb-0.5 pt-1.5 text-mini font-medium text-tertiary">
                      {section.label}
                    </div>
                    {section.items.map((item) => {
                      itemIndex += 1;
                      const currentIndex = itemIndex;
                      const ItemIcon = SECTION_META[item.kind].icon;
                      const selected = currentIndex === activeIndex;
                      return (
                        <button
                          key={`${item.kind}-${item.id}`}
                          type="button"
                          data-command-index={currentIndex}
                          className={cn(
                            "command-search-item flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left transition-colors",
                            selected
                              ? "bg-surface-hover"
                              : "hover:bg-surface-hover/70",
                          )}
                          onMouseEnter={() => setActiveIndex(currentIndex)}
                          onClick={() => activateItem(item)}
                        >
                          <span className="flex size-6 shrink-0 items-center justify-center rounded-[6px] bg-surface-control text-secondary">
                            <ItemIcon className="size-3" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[12px] leading-4 text-primary">
                              {item.title}
                            </span>
                            {item.subtitle ? (
                              <span className="block truncate text-[10px] leading-[13px] text-tertiary">
                                {item.subtitle}
                              </span>
                            ) : null}
                          </span>
                          {item.meta ? (
                            <span
                              className={cn(
                                "shrink-0 text-[10px] leading-[13px] tabular-nums",
                                item.running ? "text-accent" : "text-tertiary",
                              )}
                            >
                              {item.meta}
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                ))
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function useCommandSearchShortcut(onOpen: () => void) {
  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      if (e.code !== "KeyK") return;
      e.preventDefault();
      onOpen();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onOpen]);
}
