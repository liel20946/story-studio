import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  PlayIcon,
  CheckCircle2Icon,
  XCircleIcon,
  XIcon,
  Loader2Icon,
  ChevronRightIcon,
  ChevronLeftIcon,
} from "lucide-react";
import {
  ScrollArea,
  Toolbar,
  ToolbarRow,
  ToolbarContent,
  ToolbarTitle,
  ToolbarActions,
  Button,
  Badge,
  Text,
  Checkbox,
  EmptyState,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import { storiesList, runStart } from "../lib/ipc";
import type { StorySummary, RunStatus } from "../lib/contract-types";
import {
  useSections,
  DEFAULT_SECTION_ID,
  type StorySection,
} from "../lib/sections-store";
import { useRegisterRun, useAllRuns, useActiveRunMap } from "../lib/run-store";
import { useBulkRun, type BulkLaunchedItem } from "../lib/bulk-run-store";

// A section as rendered here: built-in "Stories" group + each user section.
interface Group {
  id: string;
  name: string;
  stories: StorySummary[];
}

// Live status of a launched run — "running" until a result arrives.
type LiveStatus = RunStatus | "running";

function statusBadge(status: LiveStatus): React.ReactNode {
  switch (status) {
    case "passed":
      return <Badge color="green">Passed</Badge>;
    case "failed":
    case "error":
      return <Badge color="red">Failed</Badge>;
    case "cancelled":
      return <Badge color="secondary">Cancelled</Badge>;
    default:
      return <Badge color="blue">Running</Badge>;
  }
}

function statusIcon(status: LiveStatus): React.ReactNode {
  switch (status) {
    case "passed":
      return <CheckCircle2Icon className="size-4 text-support-green" />;
    case "failed":
    case "error":
      return <XCircleIcon className="size-4 text-support-red" />;
    case "cancelled":
      return <XIcon className="size-4 text-secondary" />;
    default:
      return <Loader2Icon className="size-4 animate-spin text-support-blue" />;
  }
}

// ---------- selection phase ----------
function StoryRow({
  story,
  checked,
  onToggle,
}: {
  story: StorySummary;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-control px-3 py-2",
        "hover:bg-surface-hover",
      )}
    >
      <Checkbox checked={checked} onCheckedChange={onToggle} />
      <Text variant="regular" className="truncate">
        {story.title}
      </Text>
    </label>
  );
}

function SelectionView({
  groups,
  total,
  selected,
  onToggleStory,
  onToggleGroup,
}: {
  groups: Group[];
  total: number;
  selected: Set<string>;
  onToggleStory: (name: string) => void;
  onToggleGroup: (group: Group, select: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-5 px-8 py-4 pb-8">
      {groups.map((group) => {
        const groupNames = group.stories.map((s) => s.name);
        const selectedInGroup = groupNames.filter((n) =>
          selected.has(n),
        ).length;
        const allSelected =
          group.stories.length > 0 && selectedInGroup === group.stories.length;
        return (
          <div key={group.id} className="flex flex-col">
            <label className="mb-1 flex cursor-pointer items-center gap-2 px-1 py-0.5">
              <Checkbox
                checked={
                  allSelected
                    ? true
                    : selectedInGroup > 0
                      ? "indeterminate"
                      : false
                }
                onCheckedChange={() => onToggleGroup(group, !allSelected)}
              />
              <Text variant="small-strong" color="secondary">
                {group.name}
              </Text>
              <Text variant="small" color="tertiary">
                {selectedInGroup}/{group.stories.length}
              </Text>
            </label>
            <div className="flex flex-col">
              {group.stories.map((story) => (
                <StoryRow
                  key={story.name}
                  story={story}
                  checked={selected.has(story.name)}
                  onToggle={() => onToggleStory(story.name)}
                />
              ))}
            </div>
          </div>
        );
      })}
      {total === 0 && (
        <EmptyState
          title="No stories yet"
          description="Record a story first, then come back to run several at once."
        />
      )}
    </div>
  );
}

// ---------- running phase (dashboard) ----------
function Dashboard({ launched }: { launched: BulkLaunchedItem[] }) {
  const navigate = useNavigate();
  const runs = useAllRuns();

  const rows = launched.map((item) => {
    const st = runs[item.runId];
    const status: LiveStatus = st?.result ? st.result.status : "running";
    return { ...item, status };
  });

  const running = rows.filter((r) => r.status === "running").length;
  const passed = rows.filter((r) => r.status === "passed").length;
  const failed = rows.filter(
    (r) => r.status === "failed" || r.status === "error",
  ).length;
  const cancelled = rows.filter((r) => r.status === "cancelled").length;

  return (
    <div className="flex flex-col gap-4 px-8 py-4 pb-8">
      <div className="flex flex-wrap items-center gap-2">
        {running > 0 && <Badge color="blue">{running} running</Badge>}
        {passed > 0 && <Badge color="green">{passed} passed</Badge>}
        {failed > 0 && <Badge color="red">{failed} failed</Badge>}
        {cancelled > 0 && <Badge color="secondary">{cancelled} cancelled</Badge>}
      </div>

      <div className="flex flex-col">
        {rows.map(({ storyTitle, runId, status }) => (
          <button
            key={runId}
            type="button"
            onClick={() => navigate({ to: "/run/$runId", params: { runId } })}
            className="flex items-center gap-3 rounded-control px-3 py-2 text-left transition-colors hover:bg-surface-hover"
          >
            <span className="shrink-0">{statusIcon(status)}</span>
            <Text variant="regular" className="truncate">
              {storyTitle}
            </Text>
            <span className="ml-auto flex shrink-0 items-center gap-2">
              {statusBadge(status)}
              <ChevronRightIcon className="size-4 text-tertiary" />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function BulkRunView() {
  const { sections, assignments } = useSections();
  const registerRun = useRegisterRun();
  const activeRuns = useActiveRunMap();
  const allRuns = useAllRuns();
  const { launched, setLaunched } = useBulkRun();

  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [isStarting, setIsStarting] = React.useState(false);

  // The launched bulk is still in progress while any of its runs has no result.
  // While active we keep showing the dashboard and block starting another bulk.
  const bulkRunning =
    launched != null &&
    launched.some((item) => !allRuns[item.runId]?.result);

  const storiesQuery = useQuery({
    queryKey: ["stories:list"],
    queryFn: storiesList,
  });
  const stories = React.useMemo(
    () => storiesQuery.data ?? [],
    [storiesQuery.data],
  );

  // Group stories the same way the sidebar does: each user section, then a
  // default "Stories" group for everything unassigned (or assigned to a section
  // that no longer exists).
  const groups: Group[] = React.useMemo(() => {
    const ids = new Set(sections.map((s) => s.id));
    const bySection = new Map<string, StorySummary[]>();
    const unassigned: StorySummary[] = [];
    for (const story of stories) {
      const sid = assignments[story.name];
      if (sid && ids.has(sid)) {
        const arr = bySection.get(sid);
        if (arr) arr.push(story);
        else bySection.set(sid, [story]);
      } else {
        unassigned.push(story);
      }
    }
    const result: Group[] = sections
      .map((s: StorySection) => ({
        id: s.id,
        name: s.name,
        stories: bySection.get(s.id) ?? [],
      }))
      .filter((g) => g.stories.length > 0);
    if (unassigned.length > 0) {
      result.push({
        id: DEFAULT_SECTION_ID,
        name: "Stories",
        stories: unassigned,
      });
    }
    return result;
  }, [stories, sections, assignments]);

  const total = stories.length;
  const allSelected = total > 0 && selected.size === total;

  function toggleStory(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function toggleGroup(group: Group, select: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const s of group.stories) {
        if (select) next.add(s.name);
        else next.delete(s.name);
      }
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(stories.map((s) => s.name)));
  }

  async function handleRun() {
    if (isStarting || selected.size === 0) return;
    const chosen = stories.filter((s) => selected.has(s.name));
    setIsStarting(true);
    try {
      // Fire every selected story at once. If a story is already running in the
      // background, reuse its in-flight run instead of starting a duplicate.
      const results: BulkLaunchedItem[] = await Promise.all(
        chosen.map(async (story) => {
          const existing = activeRuns.get(story.name);
          if (existing)
            return {
              storyName: story.name,
              storyTitle: story.title,
              runId: existing,
            };
          const { runId } = await runStart(story.name);
          registerRun(runId, story.name, story.title);
          return { storyName: story.name, storyTitle: story.title, runId };
        }),
      );
      setLaunched(results);
    } catch (err) {
      console.error("[BulkRunView] bulk run start failed", err);
    } finally {
      setIsStarting(false);
    }
  }

  // ----- running dashboard -----
  if (launched) {
    return (
      <ScrollArea
        toolbar={
          <Toolbar titlebar surface="main" seamless>
            <ToolbarRow inset="main">
              <ToolbarContent>
                <ToolbarTitle>
                  {bulkRunning
                    ? `Running ${launched.length} stories`
                    : `Ran ${launched.length} stories`}
                </ToolbarTitle>
              </ToolbarContent>
              <ToolbarActions>
                <Button
                  variant="glass"
                  size="medium"
                  disabled={bulkRunning}
                  onClick={() => {
                    setLaunched(null);
                    setSelected(new Set());
                  }}
                >
                  <ChevronLeftIcon className="size-4" />
                  Run more
                </Button>
              </ToolbarActions>
            </ToolbarRow>
          </Toolbar>
        }
      >
        <Dashboard launched={launched} />
      </ScrollArea>
    );
  }

  // ----- selection -----
  return (
    <ScrollArea
      toolbar={
        <Toolbar titlebar surface="main" seamless>
          <ToolbarRow inset="main">
            <ToolbarContent>
              <ToolbarTitle>Run stories</ToolbarTitle>
            </ToolbarContent>
            <ToolbarActions>
              {total > 0 && (
                <Button variant="glass" size="medium" radius="full" onClick={toggleAll}>
                  {allSelected ? "Deselect all" : "Select all"}
                </Button>
              )}
              <Button
                variant="glass"
                size="medium"
                radius="full"
                onClick={handleRun}
                disabled={selected.size === 0 || isStarting}
              >
                {isStarting ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : (
                  <PlayIcon className="size-4" />
                )}
                {selected.size > 0 ? `Run ${selected.size}` : "Run"}
              </Button>
            </ToolbarActions>
          </ToolbarRow>
        </Toolbar>
      }
    >
      <SelectionView
        groups={groups}
        total={total}
        selected={selected}
        onToggleStory={toggleStory}
        onToggleGroup={toggleGroup}
      />
    </ScrollArea>
  );
}
