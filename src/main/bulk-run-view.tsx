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
  SquareIcon,
  RotateCcwIcon,
  SkipForwardIcon,
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
  Textarea,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import { reportAppError, reportAppErrorFromUnknown } from "@/lib/app-error";
import {
  storiesList,
  runBulkStart,
  runBulkStop,
  runBulkResume,
  onBulkStatus,
} from "../lib/ipc";
import type { StorySummary, RunStatus, BulkItemPhase } from "../lib/contract-types";
import {
  useSections,
  DEFAULT_SECTION_ID,
  type StorySection,
} from "../lib/sections-store";
import { useRegisterRun, useAllRuns, useActiveRunMap } from "../lib/run-store";
import {
  useBulkRun,
  type BulkLaunchedItem,
  readPersistedSession,
} from "../lib/bulk-run-store";

const PARALLEL_OPTIONS = [1, 2, 3, 4, 5, 6] as const;

// A section as rendered here: built-in "Stories" group + each user section.
interface Group {
  id: string;
  name: string;
  stories: StorySummary[];
}

// Live status of a launched run — "running" until a result arrives.
type LiveStatus = RunStatus | "running" | "pending" | "skipped";

type DashboardRow = BulkLaunchedItem & { status: LiveStatus };

function statusBadge(status: LiveStatus): React.ReactNode {
  switch (status) {
    case "passed":
      return <Badge color="green">Passed</Badge>;
    case "failed":
    case "error":
      return <Badge color="red">Failed</Badge>;
    case "cancelled":
      return <Badge color="neutral">Cancelled</Badge>;
    case "skipped":
      return <Badge color="neutral">Not run</Badge>;
    case "pending":
      return <Badge color="neutral">Queued</Badge>;
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
    case "skipped":
      return <SkipForwardIcon className="size-4 text-secondary" />;
    case "pending":
      return <Loader2Icon className="size-4 text-tertiary" />;
    default:
      return <Loader2Icon className="size-4 animate-spin text-accent" />;
  }
}

function liveStatusForItem(
  item: BulkLaunchedItem,
  resultStatus: RunStatus | undefined,
): LiveStatus {
  // Prefer bulk phase so stories aborted for stop/resume show as skipped,
  // even if their individual agent run finished as cancelled.
  if (item.phase === "skipped") return "skipped";
  if (resultStatus) return resultStatus;
  if (item.phase === "pending") return "pending";
  return "running";
}

function isFinishedStatus(status: LiveStatus): boolean {
  return (
    status === "passed" ||
    status === "failed" ||
    status === "error" ||
    status === "cancelled"
  );
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

function BulkRunOptionsPanel({
  maxParallel,
  stopCondition,
  onMaxParallelChange,
  onStopConditionChange,
}: {
  maxParallel: string;
  stopCondition: string;
  onMaxParallelChange: (value: string) => void;
  onStopConditionChange: (value: string) => void;
}) {
  return (
    <div className="mb-1 flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="bulk-max-parallel" className="text-strong">
          Parallel subagents
        </label>
        <Text variant="small" color="tertiary">
          How many stories run at the same time.
        </Text>
        <select
          id="bulk-max-parallel"
          aria-label="Parallel subagents"
          value={maxParallel}
          onChange={(e) => onMaxParallelChange(e.target.value)}
          className={cn(
            "h-9 w-44 appearance-none rounded-control border border-field bg-control",
            "bg-[length:12px] bg-[right_0.75rem_center] bg-no-repeat",
            "px-3 pr-8 text-regular text-primary outline-none",
            "focus:border-field",
          )}
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
          }}
        >
          {PARALLEL_OPTIONS.map((n) => (
            <option key={n} value={String(n)}>
              {n} at a time
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="bulk-stop-condition" className="text-strong">
          Stop condition
          <span className="ml-1.5 font-normal text-tertiary">(optional)</span>
        </label>
        <Text variant="small" color="tertiary">
          When a finished story matches this text, remaining stories are not run.
        </Text>
        <Textarea
          id="bulk-stop-condition"
          value={stopCondition}
          onChange={(e) => onStopConditionChange(e.target.value)}
          placeholder='e.g. "stop on first failure"'
          rows={2}
          className="min-h-[64px] resize-y"
        />
      </div>
    </div>
  );
}

function SelectionView({
  groups,
  total,
  selected,
  maxParallel,
  stopCondition,
  onToggleStory,
  onToggleGroup,
  onMaxParallelChange,
  onStopConditionChange,
}: {
  groups: Group[];
  total: number;
  selected: Set<string>;
  maxParallel: string;
  stopCondition: string;
  onToggleStory: (name: string) => void;
  onToggleGroup: (group: Group, select: boolean) => void;
  onMaxParallelChange: (value: string) => void;
  onStopConditionChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-5 px-8 py-4 pb-8">
      <BulkRunOptionsPanel
        maxParallel={maxParallel}
        stopCondition={stopCondition}
        onMaxParallelChange={onMaxParallelChange}
        onStopConditionChange={onStopConditionChange}
      />
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
        <EmptyState title="No stories yet." />
      )}
    </div>
  );
}

// ---------- running phase (dashboard) ----------
function StoryResultRow({
  row,
  muted,
}: {
  row: DashboardRow;
  muted?: boolean;
}) {
  const navigate = useNavigate();
  const clickable = row.phase !== "pending" && row.phase !== "skipped";
  const body = (
    <>
      <span className="shrink-0">{statusIcon(row.status)}</span>
      <Text variant="regular" className="truncate">
        {row.storyTitle}
      </Text>
      <span className="ml-auto flex shrink-0 items-center gap-2">
        {statusBadge(row.status)}
        {clickable ? (
          <ChevronRightIcon className="size-4 text-tertiary" />
        ) : (
          <span className="size-4" />
        )}
      </span>
    </>
  );

  if (!clickable) {
    return (
      <div
        className={cn(
          "flex items-center gap-3 rounded-control px-3 py-2 text-left",
          muted && "opacity-80",
        )}
      >
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => navigate({ to: "/run/$runId", params: { runId: row.runId } })}
      className="flex items-center gap-3 rounded-control px-3 py-2 text-left transition-colors hover:bg-surface-hover"
    >
      {body}
    </button>
  );
}

function DashboardSection({
  title,
  description,
  rows,
  muted,
}: {
  title: string;
  description?: string;
  rows: DashboardRow[];
  muted?: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <div className="px-1">
        <Text variant="small-strong" color="secondary">
          {title}
          <span className="ml-1.5 font-normal text-tertiary">({rows.length})</span>
        </Text>
        {description ? (
          <Text variant="small" color="tertiary" className="mt-0.5">
            {description}
          </Text>
        ) : null}
      </div>
      <div className="flex flex-col">
        {rows.map((row) => (
          <StoryResultRow key={row.runId} row={row} muted={muted} />
        ))}
      </div>
    </div>
  );
}

function Dashboard({
  launched,
  status,
}: {
  launched: BulkLaunchedItem[];
  status?: string;
}) {
  const runs = useAllRuns();

  const rows = launched.map((item) => {
    const st = runs[item.runId];
    const statusLive: LiveStatus = liveStatusForItem(
      item,
      st?.result?.status,
    );
    return { ...item, status: statusLive };
  });

  const running = rows.filter((r) => r.status === "running").length;
  const pending = rows.filter((r) => r.status === "pending").length;
  const passed = rows.filter((r) => r.status === "passed").length;
  const failed = rows.filter(
    (r) => r.status === "failed" || r.status === "error",
  ).length;
  const cancelled = rows.filter((r) => r.status === "cancelled").length;
  const notRun = rows.filter((r) => r.status === "skipped").length;
  const stopped = status === "stopped";

  const ranRows = rows.filter((r) => isFinishedStatus(r.status));
  const notRunRows = rows.filter((r) => r.status === "skipped");

  return (
    <div className="flex flex-col gap-5 px-8 py-4 pb-8">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {running > 0 && <Badge color="blue">{running} running</Badge>}
          {pending > 0 && <Badge color="neutral">{pending} queued</Badge>}
          {passed > 0 && <Badge color="green">{passed} passed</Badge>}
          {failed > 0 && <Badge color="red">{failed} failed</Badge>}
          {cancelled > 0 && <Badge color="neutral">{cancelled} cancelled</Badge>}
          {notRun > 0 && <Badge color="neutral">{notRun} not run</Badge>}
          {stopped && <Badge color="orange">Stopped</Badge>}
        </div>
      </div>

      {stopped ? (
        <div className="flex flex-col gap-6">
          <DashboardSection
            title="Finished"
            description={
              ranRows.length === 0
                ? "No stories finished before the stop."
                : undefined
            }
            rows={ranRows}
          />
          <DashboardSection
            title="Not run yet"
            description="These will start when you resume."
            rows={notRunRows}
            muted
          />
        </div>
      ) : (
        <div className="flex flex-col">
          {rows.map((row) => (
            <StoryResultRow key={row.runId} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}

export function BulkRunView() {
  const { sections, assignments } = useSections();
  const registerRun = useRegisterRun();
  const activeRuns = useActiveRunMap();
  const allRuns = useAllRuns();
  const { session, setSession } = useBulkRun();

  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [isStarting, setIsStarting] = React.useState(false);
  const [isStopping, setIsStopping] = React.useState(false);
  const [isResuming, setIsResuming] = React.useState(false);
  const [maxParallel, setMaxParallel] = React.useState("3");
  const [stopCondition, setStopCondition] = React.useState("");

  // Keep showing the dashboard while any bulk story is still running or
  // skipped after a stop. Recover from sessionStorage if provider state was lost.
  const displaySession = React.useMemo(() => {
    if (session?.items.length) return session;

    const stored = readPersistedSession();
    if (stored?.items.length) {
      const anyOpen = stored.items.some((item) => {
        if (item.phase === "skipped" || item.phase === "pending") return true;
        return !allRuns[item.runId]?.result;
      });
      if (anyOpen || stored.status === "stopped") return stored;
    }

    const active = Object.values(allRuns).filter(
      (r) => r.result === null && r.storyName,
    );
    if (active.length >= 2) {
      return {
        bulkId: `recovered-${Date.now()}`,
        items: active.map((r) => ({
          storyName: r.storyName,
          storyTitle: r.storyTitle,
          runId: r.runId,
          phase: "running" as BulkItemPhase,
        })),
        maxParallel: 3,
        stopCondition: "",
        status: "running" as const,
      };
    }

    return null;
  }, [session, allRuns]);

  const displayLaunched = displaySession?.items ?? null;

  React.useEffect(() => {
    if (session == null && displaySession != null) {
      setSession(displaySession);
    }
  }, [session, displaySession, setSession]);

  // Sync maxParallel / stopCondition inputs from an active session when present.
  React.useEffect(() => {
    if (!session) return;
    setMaxParallel(String(session.maxParallel || 3));
    setStopCondition(session.stopCondition || "");
  }, [session?.bulkId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live bulk status from main process (phases, stop reason).
  React.useEffect(() => {
    return onBulkStatus((snapshot) => {
      setSession((prev) => {
        if (prev && prev.bulkId !== snapshot.bulkId) return prev;
        const phaseByRun = new Map(
          snapshot.items.map((i) => [i.runId, i.phase] as const),
        );
        const items =
          prev?.items.map((item) => ({
            ...item,
            phase: phaseByRun.get(item.runId) ?? item.phase,
          })) ??
          snapshot.items.map((i) => ({
            storyName: i.storyName,
            storyTitle: i.storyTitle,
            runId: i.runId,
            phase: i.phase,
          }));
        return {
          bulkId: snapshot.bulkId,
          items,
          maxParallel: snapshot.maxParallel,
          stopCondition: snapshot.stopCondition,
          status: snapshot.status,
          stopReason: snapshot.stopReason,
        };
      });
    });
  }, [setSession]);

  // Return to selection only after every bulk story is done (or skipped) and
  // the session is completed — keep stopped sessions so Resume stays available.
  React.useEffect(() => {
    if (!session?.items.length) return;
    if (session.status === "stopped" || session.status === "running") return;
    const allSettled = session.items.every((item) => {
      if (item.phase === "skipped") return true;
      return !!allRuns[item.runId]?.result;
    });
    if (!allSettled) return;
    setSession(null);
    setSelected(new Set());
  }, [session, allRuns, setSession]);

  const bulkRunning =
    displaySession != null &&
    displaySession.status === "running" &&
    displaySession.items.some(
      (item) =>
        item.phase !== "skipped" &&
        item.phase !== "done" &&
        !allRuns[item.runId]?.result,
    );

  const canResume =
    displaySession?.status === "stopped" &&
    displaySession.items.some(
      (item) => item.phase === "skipped" || item.phase === "pending",
    );

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
      // Start one agent thread per story. Reuse any in-flight single-story runs as-is.
      const alreadyRunning: BulkLaunchedItem[] = [];
      const toBulk: typeof chosen = [];
      for (const story of chosen) {
        const existing = activeRuns.get(story.name);
        if (existing) {
          alreadyRunning.push({
            storyName: story.name,
            storyTitle: story.title,
            runId: existing,
            phase: "running",
          });
        } else {
          toBulk.push(story);
        }
      }

      const options = {
        maxParallel: Number(maxParallel) || 3,
        stopCondition: stopCondition.trim() || undefined,
      };

      let bulkLaunched: BulkLaunchedItem[] = [];
      let bulkId = `local-${Date.now()}`;
      if (toBulk.length > 0) {
        const result = await runBulkStart(
          toBulk.map((s) => s.name),
          options,
        );
        bulkId = result.bulkId;
        for (const item of result.items) {
          registerRun(item.runId, item.storyName, item.storyTitle, {
            agentProvider: result.agentProvider,
            agentModel: result.agentModel,
          });
        }
        bulkLaunched = result.items.map((item) => ({
          ...item,
          phase: "pending" as const,
        }));
      }

      const launchedItems = [...alreadyRunning, ...bulkLaunched];
      if (launchedItems.length === 0) {
        reportAppError("No stories were started");
        return;
      }
      setSession({
        bulkId,
        items: launchedItems,
        maxParallel: options.maxParallel,
        stopCondition: options.stopCondition ?? "",
        status: "running",
      });
    } catch (err) {
      reportAppErrorFromUnknown("Bulk run failed to start", err);
    } finally {
      setIsStarting(false);
    }
  }

  async function handleStop() {
    if (!session?.bulkId || isStopping) return;
    setIsStopping(true);
    try {
      const snapshot = await runBulkStop(session.bulkId);
      setSession({
        bulkId: snapshot.bulkId,
        items: session.items.map((item) => {
          const phase = snapshot.items.find((i) => i.runId === item.runId)?.phase;
          return { ...item, phase: phase ?? item.phase };
        }),
        maxParallel: snapshot.maxParallel,
        stopCondition: snapshot.stopCondition,
        status: snapshot.status,
        stopReason: snapshot.stopReason,
      });
    } catch (err) {
      reportAppErrorFromUnknown("Failed to stop bulk run", err);
    } finally {
      setIsStopping(false);
    }
  }

  async function handleResume() {
    if (!session || isResuming) return;
    const pendingNames = session.items
      .filter((item) => item.phase === "skipped" || item.phase === "pending")
      .map((item) => item.storyName);
    if (pendingNames.length === 0) {
      reportAppError("Nothing left to resume");
      return;
    }
    setIsResuming(true);
    try {
      const options = {
        maxParallel: session.maxParallel || Number(maxParallel) || 3,
        stopCondition:
          session.stopCondition.trim() || stopCondition.trim() || undefined,
      };
      const result = await runBulkResume(session.bulkId, pendingNames, options);
      for (const item of result.items) {
        registerRun(item.runId, item.storyName, item.storyTitle, {
          agentProvider: result.agentProvider,
          agentModel: result.agentModel,
        });
      }
      const kept = session.items.filter(
        (item) => item.phase !== "skipped" && item.phase !== "pending",
      );
      setSession({
        bulkId: result.bulkId,
        items: [
          ...kept,
          ...result.items.map((item) => ({
            ...item,
            phase: "pending" as const,
          })),
        ],
        maxParallel: result.maxParallel,
        stopCondition: result.stopCondition,
        status: "running",
        stopReason: undefined,
      });
    } catch (err) {
      reportAppErrorFromUnknown("Failed to resume bulk run", err);
    } finally {
      setIsResuming(false);
    }
  }

  // ----- running dashboard -----
  if (displayLaunched != null && displayLaunched.length > 0) {
    return (
      <ScrollArea
        toolbar={
          <Toolbar titlebar surface="main" seamless>
            <ToolbarRow inset="main" className="main-titlebar-row detail-view-toolbar">
              <ToolbarContent className="detail-view-toolbar-content">
                <ToolbarTitle>
                  {bulkRunning
                    ? `Running ${displayLaunched.length} stories`
                    : displaySession?.status === "stopped"
                      ? `Stopped · ${displayLaunched.length} stories`
                      : `Ran ${displayLaunched.length} stories`}
                </ToolbarTitle>
              </ToolbarContent>
              <ToolbarActions className="detail-view-toolbar-actions">
                {bulkRunning && (
                  <Button
                    variant="glass"
                    size="titlebar"
                    disabled={isStopping}
                    onClick={() => void handleStop()}
                  >
                    {isStopping ? (
                      <Loader2Icon className="size-4 animate-spin" />
                    ) : (
                      <SquareIcon className="size-4" />
                    )}
                    Stop
                  </Button>
                )}
                {canResume && (
                  <Button
                    variant="accent"
                    size="titlebar"
                    radius="full"
                    disabled={isResuming}
                    onClick={() => void handleResume()}
                  >
                    {isResuming ? (
                      <Loader2Icon className="size-4 animate-spin" />
                    ) : (
                      <RotateCcwIcon className="size-4" />
                    )}
                    Resume
                  </Button>
                )}
                <Button
                  variant="glass"
                  size="titlebar"
                  disabled={bulkRunning}
                  onClick={() => {
                    setSession(null);
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
        <Dashboard
          launched={displayLaunched}
          status={displaySession?.status}
        />
      </ScrollArea>
    );
  }

  // ----- selection -----
  return (
    <ScrollArea
      toolbar={
        <Toolbar titlebar surface="main" seamless>
          <ToolbarRow inset="main" className="main-titlebar-row detail-view-toolbar">
            <ToolbarContent className="detail-view-toolbar-content">
              <ToolbarTitle>Run stories</ToolbarTitle>
            </ToolbarContent>
            <ToolbarActions className="detail-view-toolbar-actions">
              {total > 0 && (
                <Button variant="glass" size="titlebar" radius="full" onClick={toggleAll}>
                  {allSelected ? "Deselect all" : "Select all"}
                </Button>
              )}
              <Button
                variant="accent"
                size="titlebar"
                radius="full"
                onClick={() => void handleRun()}
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
        maxParallel={maxParallel}
        stopCondition={stopCondition}
        onToggleStory={toggleStory}
        onToggleGroup={toggleGroup}
        onMaxParallelChange={setMaxParallel}
        onStopConditionChange={setStopCondition}
      />
    </ScrollArea>
  );
}
