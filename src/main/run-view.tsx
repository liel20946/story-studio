import * as React from "react";
import { useParams, useNavigate } from "@tanstack/react-router";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import {
  ClockIcon,
  Loader2Icon,
  CheckCircle2Icon,
  XCircleIcon,
  XIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  BookOpenIcon,
  RotateCcwIcon,
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
} from "@/components/ui";
import {
  runsGet,
  runCancel,
  runStart,
  runsLiveScreenshots,
  runsLiveTimeline,
} from "../lib/ipc";
import { cn } from "@/lib/utils";
import { reportAppErrorFromUnknown } from "@/lib/app-error";
import type {
  RunEvent,
  RunResult,
  RunRecord,
  RunStatus,
  AgentProvider,
} from "../lib/contract-types";
import { formatAgentModelLabel, formatAgentProviderLabel } from "../lib/agent-config";
import { useRegisterRun, useRun } from "../lib/run-store";
import {
  filterTimelineEvents,
  isActionEvent,
  pickLiveTimelineEvents,
} from "../lib/run-events";
import { useRunScreenshotIndex } from "../lib/use-run-screenshot-index";
import { ScreenshotImage, ScreenshotLightbox } from "../components/screenshot-image";
import { RailAssertionLine } from "../components/rail-assertion-line";

// ---------- jump back to the story detail from a run ----------
function ViewStoryButton({ storyName }: { storyName?: string }) {
  const navigate = useNavigate();
  if (!storyName) return null;
  return (
    <Button
      variant="filled"
      size="titlebar"
      radius="full"
      onClick={() =>
        navigate({ to: "/story/$name", params: { name: storyName } })
      }
    >
      <BookOpenIcon className="size-4" />
      View story
    </Button>
  );
}

// ---------- retry a finished run with the same variables ----------
function RetryRunButton({
  storyName,
  storyTitle,
  variableOverrides,
}: {
  storyName?: string;
  storyTitle?: string;
  variableOverrides?: Record<string, string>;
}) {
  const navigate = useNavigate();
  const registerRun = useRegisterRun();
  const [isStarting, setIsStarting] = React.useState(false);

  if (!storyName) return null;

  async function handleRetry() {
    if (!storyName || isStarting) return;
    setIsStarting(true);
    try {
      const { runId, agentProvider, agentModel, variableOverrides: startedVars } =
        await runStart(storyName, variableOverrides);
      registerRun(runId, storyName, storyTitle ?? storyName, {
        agentProvider,
        agentModel,
        variableOverrides: startedVars ?? variableOverrides,
      });
      navigate({ to: "/run/$runId", params: { runId } });
    } catch (err) {
      reportAppErrorFromUnknown("Failed to retry run", err);
    } finally {
      setIsStarting(false);
    }
  }

  return (
    <Button
      variant="accent"
      size="titlebar"
      radius="full"
      onClick={handleRetry}
      disabled={isStarting}
      aria-label="Retry run"
    >
      {isStarting ? (
        <Loader2Icon className="size-4 animate-spin" />
      ) : (
        <RotateCcwIcon className="size-4" />
      )}
      Retry
    </Button>
  );
}

// ---------- status helpers (mirrors story-view) ----------
function statusColor(status: RunStatus): "green" | "red" | "neutral" {
  switch (status) {
    case "passed":
      return "green";
    case "cancelled":
      return "neutral";
    default:
      return "red";
  }
}

function statusLabel(status: RunStatus): string {
  switch (status) {
    case "passed":
      return "Passed";
    case "failed":
      return "Failed";
    case "error":
      return "Error";
    case "cancelled":
      return "Cancelled";
    case "blocked":
      return "Blocked";
  }
}

// Run views show how LONG the run took (duration), not how long ago it ran.
function formatDuration(ms: number): string {
  const secs = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// Cap how many distinct detail values we stitch together for a merged row —
// beyond this it reads better as "and N more" than as a wall of refs.
const MAX_MERGED_DETAILS = 4;

function formatMergedDetail(details: string[]): string {
  if (details.length <= MAX_MERGED_DETAILS) return details.join(", ");
  const shown = details.slice(0, MAX_MERGED_DETAILS);
  return `${shown.join(", ")}, +${details.length - MAX_MERGED_DETAILS} more`;
}

// Browser actions must remain individual rows: grouping three navigations or
// clicks into one changing ×N row makes the live timeline look unstable and
// hides the actual execution order. Collapse only non-action diagnostics.
function collapseEvents(events: RunEvent[]): { event: RunEvent; count: number }[] {
  const groups: { event: RunEvent; count: number; details: string[] }[] = [];
  for (const event of events) {
    const prev = groups[groups.length - 1];
    if (
      prev &&
      !isActionEvent(event) &&
      !isActionEvent(prev.event) &&
      prev.event.kind === event.kind &&
      prev.event.label === event.label
    ) {
      prev.count += 1;
      prev.event = { ...prev.event, status: event.status };
      if (event.detail && prev.details[prev.details.length - 1] !== event.detail) {
        prev.details.push(event.detail);
      }
    } else {
      groups.push({ event, count: 1, details: event.detail ? [event.detail] : [] });
    }
  }
  return groups.map(({ event, count, details }) => ({
    event: count > 1 ? { ...event, detail: formatMergedDetail(details) } : event,
    count,
  }));
}

/** Parse `step-N-…` from a screenshot filename when present. */
function stepIndexFromScreenshotPath(filePath: string): number | null {
  const base = filePath.split(/[/\\]/).pop() ?? "";
  const match = base.match(/^step-(\d+)[-.]/i);
  if (!match) return null;
  const n = Number.parseInt(match[1], 10);
  return Number.isFinite(n) ? n : null;
}

/** Map a selected action row → the best matching screenshot gallery index. */
function screenshotIndexForAction(
  actionIndex: number,
  collapsed: { event: RunEvent }[],
  paths: string[],
): number {
  if (paths.length === 0 || collapsed.length === 0) return 0;
  const event = collapsed[actionIndex]?.event;
  if (!event) return 0;

  const exact = paths.findIndex((p) => stepIndexFromScreenshotPath(p) === event.seq);
  if (exact >= 0) return exact;

  let best = -1;
  let bestStep = -1;
  for (let i = 0; i < paths.length; i++) {
    const step = stepIndexFromScreenshotPath(paths[i]);
    if (step != null && step <= event.seq && step >= bestStep) {
      best = i;
      bestStep = step;
    }
  }
  if (best >= 0) return best;

  if (collapsed.length === 1) return 0;
  return Math.min(
    paths.length - 1,
    Math.round((actionIndex / (collapsed.length - 1)) * (paths.length - 1)),
  );
}

/** Map a screenshot gallery index → the best matching action row. */
function actionIndexForScreenshot(
  shotIndex: number,
  collapsed: { event: RunEvent }[],
  paths: string[],
): number {
  if (collapsed.length === 0) return 0;
  const path = paths[shotIndex];
  const step = path ? stepIndexFromScreenshotPath(path) : null;
  if (step != null) {
    const exact = collapsed.findIndex(({ event }) => event.seq === step);
    if (exact >= 0) return exact;
    let best = 0;
    for (let i = 0; i < collapsed.length; i++) {
      if (collapsed[i].event.seq <= step) best = i;
    }
    return best;
  }
  if (paths.length <= 1) return 0;
  return Math.min(
    collapsed.length - 1,
    Math.round((shotIndex / (paths.length - 1)) * (collapsed.length - 1)),
  );
}

// ---------- single timeline row ----------
function TimelineRow({
  event,
  count = 1,
  index,
  selected,
  onSelect,
}: {
  event: RunEvent;
  count?: number;
  index: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const isProse = event.kind === "message" || event.kind === "reasoning";
  return (
    <button
      type="button"
      className={cn("timeline-row group", selected && "timeline-row--selected")}
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      aria-label={`Action ${index + 1}: ${event.label}`}
    >
      <span className="timeline-num">{index + 1}</span>
      <span className="truncate text-[12px] font-medium leading-[16px] text-primary">
        {event.label}
        {count > 1 && (
          <span className="ml-1 tabular-nums text-tertiary">×{count}</span>
        )}
      </span>
      <span
        className={cn(
          "min-w-0 truncate text-[12px] leading-[16px] text-tertiary",
          !isProse && "font-mono",
        )}
      >
        {event.detail ?? ""}
      </span>
      <span className="flex shrink-0 items-center justify-end">
        {event.status === "ok" ? (
          <CheckCircle2Icon className="size-3.5 text-support-green" />
        ) : event.status === "failed" ? (
          <XCircleIcon className="size-3.5 text-support-red" />
        ) : event.status === "cancelled" ? (
          <XIcon className="size-3.5 text-secondary" />
        ) : null}
      </span>
    </button>
  );
}

// ---------- elapsed timer ----------
function ElapsedTimer({
  startedAt,
  className,
}: {
  startedAt: number;
  className?: string;
}) {
  const [elapsed, setElapsed] = React.useState(0);

  React.useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;
  return (
    <span
      className={cn(
        "tabular-nums text-[10px] leading-none text-tertiary",
        className,
      )}
    >
      {m > 0 ? `${m}m ` : ""}
      {s}s
    </span>
  );
}

function AgentPills({
  agentProvider,
  agentModel,
}: {
  agentProvider?: AgentProvider;
  agentModel?: string;
}) {
  if (!agentProvider && !agentModel) return null;
  return (
    <>
      {agentProvider ? (
        <Badge
          color={agentProvider === "claude-code" ? "orange" : "blue"}
          size="xs"
        >
          {formatAgentProviderLabel(agentProvider)}
        </Badge>
      ) : null}
      {agentModel ? (
        <Badge color="purple" size="xs">
          {formatAgentModelLabel(agentProvider ?? "codex", agentModel)}
        </Badge>
      ) : null}
    </>
  );
}

// ---------- screenshot gallery (shared by live + finished runs) ----------
function ScreenshotsGallery({
  runId,
  paths,
  selected,
  onSelectedChange,
}: {
  runId: string;
  paths: string[];
  selected: number;
  onSelectedChange: (index: number) => void;
}) {
  const [lightboxOpen, setLightboxOpen] = React.useState(false);

  React.useEffect(() => {
    setLightboxOpen(false);
  }, [runId]);

  const previewPath = paths[selected];

  if (paths.length === 0) return null;

  function goPrev() {
    onSelectedChange(Math.max(0, selected - 1));
  }

  function goNext() {
    onSelectedChange(Math.min(paths.length - 1, selected + 1));
  }

  return (
    <div className="flex flex-col gap-2 py-1">
      <ScreenshotImage
        path={previewPath}
        alt={`Step ${selected + 1}`}
        onClick={previewPath ? () => setLightboxOpen(true) : undefined}
      />
      <div className="flex items-center justify-center gap-2">
        <button
          type="button"
          disabled={selected === 0}
          onClick={goPrev}
          aria-label="Previous screenshot"
          className={cn(
            "flex size-6 items-center justify-center rounded-control border border-separator",
            selected === 0 ? "cursor-not-allowed opacity-30" : "hover:bg-surface-hover",
          )}
        >
          <ChevronLeftIcon className="size-3.5" />
        </button>
        <span className="min-w-[3rem] text-center text-[10px] tabular-nums text-tertiary">
          {selected + 1} / {paths.length}
        </span>
        <button
          type="button"
          disabled={selected === paths.length - 1}
          onClick={goNext}
          aria-label="Next screenshot"
          className={cn(
            "flex size-6 items-center justify-center rounded-control border border-separator",
            selected === paths.length - 1
              ? "cursor-not-allowed opacity-30"
              : "hover:bg-surface-hover",
          )}
        >
          <ChevronRightIcon className="size-3.5" />
        </button>
      </div>
      <ScreenshotLightbox
        paths={paths}
        index={selected}
        open={lightboxOpen}
        onOpenChange={setLightboxOpen}
        onIndexChange={onSelectedChange}
      />
    </div>
  );
}

function useLiveRunScreenshotPaths(runId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["runs:liveScreenshots", runId],
    queryFn: () => runsLiveScreenshots(runId),
    enabled,
    staleTime: 0,
    refetchInterval: enabled ? 750 : false,
    refetchIntervalInBackground: true,
    retry: 2,
  });
}

// Live rail screenshot — shows the gallery with nav; jumps to the latest capture
// (with a subtle reveal) when a new file lands on disk during the run.
function LiveScreenshotsSection({
  runId,
  selected,
  onSelectedChange,
  onPathsChange,
}: {
  runId: string;
  selected: number;
  onSelectedChange: (index: number) => void;
  onPathsChange?: (paths: string[]) => void;
}) {
  const { data } = useLiveRunScreenshotPaths(runId, true);
  const paths = data?.paths ?? [];
  const [revealing, setRevealing] = React.useState(false);
  const prevLatestRef = React.useRef<string | undefined>(undefined);

  React.useEffect(() => {
    onPathsChange?.(paths);
  }, [paths, onPathsChange]);

  React.useEffect(() => {
    prevLatestRef.current = undefined;
  }, [runId]);

  React.useEffect(() => {
    if (paths.length === 0) return;
    const latest = paths[paths.length - 1];
    if (latest !== prevLatestRef.current) {
      prevLatestRef.current = latest;
      onSelectedChange(paths.length - 1);
      setRevealing(true);
      const timer = setTimeout(() => setRevealing(false), 480);
      return () => clearTimeout(timer);
    }
  }, [paths, onSelectedChange]);

  return (
    <Section title="Screenshots">
      {paths.length > 0 ? (
        <div className={cn("screenshot-reveal", revealing && "screenshot-reveal--active")}>
          <ScreenshotsGallery
            runId={runId}
            paths={paths}
            selected={selected}
            onSelectedChange={onSelectedChange}
          />
        </div>
      ) : null}
    </Section>
  );
}

// ---------- run variables (values used for this specific run) ----------
function isSecretVariableKey(key: string): boolean {
  return /password|secret|token/i.test(key);
}

function RunVariablesSection({
  variables,
}: {
  variables?: Record<string, string>;
}) {
  const entries = Object.entries(variables ?? {}).filter(([key]) => key.trim());
  if (entries.length === 0) return null;

  return (
    <Section title="Variables">
      <div className="flex flex-col">
        {entries.map(([key, value]) => {
          const secret = isSecretVariableKey(key);
          return (
            <div
              key={key}
              className="group/var flex items-center gap-1.5 py-0.5 min-w-0 rounded-control transition-colors hover:bg-surface-hover"
            >
              <span className="w-[5.5rem] shrink-0 truncate font-mono text-[10px] leading-[13px] text-primary font-medium">
                {key}
              </span>
              <span
                className={cn(
                  "min-w-0 flex-1 truncate font-mono text-[10px] leading-[13px]",
                  value ? "text-secondary" : "text-quaternary",
                )}
              >
                {value ? (secret ? "••••••" : value) : "empty"}
              </span>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

/** Resolve the screenshot gallery paths for a finished run. */
function galleryPathsForResult(runId: string, result: RunResult): string[] {
  if (result.runId !== runId) return [];
  const stepShots =
    result.steps?.filter((s) => s.screenshot).map((s) => s.screenshot as string) ?? [];
  const galleryPaths =
    result.screenshotPaths?.length
      ? result.screenshotPaths
      : stepShots.length > 0
        ? stepShots
        : result.screenshotPath
          ? [result.screenshotPath]
          : [];
  if (galleryPaths.length > 0) return galleryPaths;
  return result.screenshotPath ? [result.screenshotPath] : [];
}

// ---------- result panel: Variables + Assertions + step-linked screenshots ----------
function ResultPanel({
  runId,
  result,
  selected,
  onSelectedChange,
}: {
  runId: string;
  result: RunResult;
  selected: number;
  onSelectedChange: (index: number) => void;
}) {
  const cancelled = result.status === "cancelled";
  const galleryPathsForView = galleryPathsForResult(runId, result);

  return (
    <>
      <RunVariablesSection variables={result.variableOverrides} />

      <Section title="Assertions">
        <div className="flex flex-col">
          {result.assertions.map((a, i) => (
            <RailAssertionLine key={i} text={a.text} passed={a.passed} />
          ))}
        </div>
      </Section>

      {!cancelled && galleryPathsForView.length > 0 && (
        <Section title="Screenshots">
          <ScreenshotsGallery
            runId={runId}
            paths={galleryPathsForView}
            selected={selected}
            onSelectedChange={onSelectedChange}
          />
        </Section>
      )}
    </>
  );
}

/** Numbered, selectable action list — selection syncs the screenshot rail. */
function ActionsTimeline({
  events,
  selectedActionIndex,
  onSelectAction,
  scrollRef,
}: {
  events: RunEvent[];
  selectedActionIndex: number;
  onSelectAction: (index: number) => void;
  scrollRef?: React.Ref<HTMLDivElement>;
}) {
  const collapsed = collapseEvents(events);
  return (
    <div
      ref={scrollRef}
      className="content-card-body run-actions-card-body timeline-list"
    >
      {collapsed.map(({ event, count }, index) => (
        <TimelineRow
          key={`${event.seq}-${event.runId}-${index}`}
          event={event}
          count={count}
          index={index}
          selected={index === selectedActionIndex}
          onSelect={() => onSelectAction(index)}
        />
      ))}
    </div>
  );
}
// Rendered as the FIRST thing in the run body, above the Actions section.
// While running it shows a blue "Running" badge + elapsed timer; once finished
// it shows the run status badge + relative time.
function RunStatusHeader({
  running,
  status,
  startedAt,
  finishedAt,
  agentProvider,
  agentModel,
}: {
  running: boolean;
  status?: RunStatus;
  startedAt: number;
  finishedAt?: number;
  agentProvider?: AgentProvider;
  agentModel?: string;
}) {
  return (
    <div className="run-rail-meta">
      {running ? (
        <>
          <Badge color="blue" size="xs">
            Running
          </Badge>
          <AgentPills agentProvider={agentProvider} agentModel={agentModel} />
          <ElapsedTimer startedAt={startedAt} className="ml-auto" />
        </>
      ) : (
        status && (
          <>
            <Badge color={statusColor(status)} size="xs">
              {statusLabel(status)}
            </Badge>
            <AgentPills agentProvider={agentProvider} agentModel={agentModel} />
            {finishedAt != null && (
              <span className="ml-auto inline-flex items-center gap-1 text-[10px] leading-none tabular-nums text-tertiary">
                <ClockIcon className="size-2.5 shrink-0" />
                {formatDuration(finishedAt - startedAt)}
              </span>
            )}
          </>
        )
      )}
    </div>
  );
}

// ---------- section (Actions / Assertions / Screenshots) ----------
// A static section header + body — always expanded (not collapsible).
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

// ---------- run status header (status + time, like the story view) ----------
function LiveRunView({ runId }: { runId: string }) {
  // Run state lives in the app-root store so it survives navigation away from
  // and back to this view — the timeline keeps accumulating in the background.
  const run = useRun(runId);
  const result = run?.result ?? null;
  const isFinished = result !== null;
  const rawEvents = run?.events ?? [];
  const latestStatus = [...rawEvents].reverse().find((e) => e.kind === "status");
  const liveTimelineQuery = useQuery({
    queryKey: ["runs:liveTimeline", runId],
    queryFn: () => runsLiveTimeline(runId),
    enabled: !isFinished,
    staleTime: 0,
    refetchInterval: !isFinished ? 500 : false,
    refetchIntervalInBackground: true,
    retry: 2,
  });
  // IPC supplies immediate MCP activity while the poll picks up canonical
  // steps.json rows, including scripts that batch many browser operations into
  // one tool call. Failed attempts stay visible instead of disappearing.
  const events = pickLiveTimelineEvents(
    rawEvents,
    liveTimelineQuery.data?.events ?? [],
    isFinished,
  );
  const startedAt = run?.startedAt ?? Date.now();
  const [isCancelling, setIsCancelling] = React.useState(false);
  const actionsBodyRef = React.useRef<HTMLDivElement>(null);
  const finishedPaths = result ? galleryPathsForResult(runId, result) : [];
  const [livePaths, setLivePaths] = React.useState<string[]>([]);
  const screenshotPaths = isFinished ? finishedPaths : livePaths;
  const pathsKey = screenshotPaths.join("\0");
  const eventsKey = events.map((e) => `${e.seq}:${e.status}`).join(",");
  const [selectedShot, setSelectedShot] = useRunScreenshotIndex(
    runId,
    screenshotPaths.length,
    { defaultToLatest: !isFinished },
  );
  const [selectedActionIndex, setSelectedActionIndex] = React.useState(0);
  // When the user picks an action, skip the reverse shot→action sync once so
  // multiple actions that share a screenshot stay independently selectable.
  const skipActionSyncRef = React.useRef(false);

  const handlePathsChange = React.useCallback((paths: string[]) => {
    setLivePaths(paths);
  }, []);

  // Keep action highlight in sync when the gallery index changes (nav / live jump).
  React.useEffect(() => {
    if (skipActionSyncRef.current) {
      skipActionSyncRef.current = false;
      return;
    }
    const collapsed = collapseEvents(events);
    if (collapsed.length === 0) {
      setSelectedActionIndex(0);
      return;
    }
    setSelectedActionIndex(
      actionIndexForScreenshot(selectedShot, collapsed, screenshotPaths),
    );
    // events/screenshotPaths are keyed above so identity churn doesn't loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- eventsKey/pathsKey
  }, [selectedShot, eventsKey, pathsKey]);

  function handleSelectAction(index: number) {
    const collapsed = collapseEvents(events);
    setSelectedActionIndex(index);
    if (screenshotPaths.length > 0) {
      skipActionSyncRef.current = true;
      setSelectedShot(screenshotIndexForAction(index, collapsed, screenshotPaths));
    }
  }

  // Auto-scroll only the Actions body. scrollIntoView would also move the
  // outer page and could push the top of the card above the viewport.
  React.useEffect(() => {
    const body = actionsBodyRef.current;
    body?.scrollTo({ top: body.scrollHeight, behavior: "smooth" });
  }, [events.length]);

  async function handleCancel() {
    setIsCancelling(true);
    try {
      await runCancel(runId);
    } catch (err) {
      reportAppErrorFromUnknown("Failed to cancel run", err);
    } finally {
      setIsCancelling(false);
    }
  }

  const agentProvider = result?.agentProvider ?? run?.agentProvider;
  const agentModel = result?.agentModel ?? run?.agentModel;

  return (
    <ScrollArea
      toolbar={
        <Toolbar titlebar surface="main" seamless>
          <ToolbarRow inset="main" className="main-titlebar-row detail-view-toolbar">
            <ToolbarContent className="detail-view-toolbar-content">
              <ToolbarTitle>
                {run?.storyTitle || run?.result?.storyTitle || "Running story"}
              </ToolbarTitle>
            </ToolbarContent>
            <ToolbarActions className="detail-view-toolbar-actions">
              <ViewStoryButton
                storyName={run?.storyName || run?.result?.storyName}
              />
              {!isFinished && (
                <Button
                  variant="glass"
                  size="titlebar"
                  onClick={handleCancel}
                  disabled={isCancelling}
                  aria-label="Cancel run"
                >
                  <XIcon className="size-4" />
                  Cancel
                </Button>
              )}
              {isFinished && (
                <RetryRunButton
                  storyName={run?.storyName || result?.storyName}
                  storyTitle={run?.storyTitle || result?.storyTitle}
                  variableOverrides={result?.variableOverrides}
                />
              )}
            </ToolbarActions>
          </ToolbarRow>
        </Toolbar>
      }
    >
      {/* Two-column run detail: the action timeline (main flow) on the left,
          status + assertions + screenshot on a right rail. */}
      <div className="detail-view run-detail-view">
        <div className="detail-view-main">
          <div className="content-card run-actions-card">
            <div className="content-card-header">
              <div className="flex min-w-0 items-center gap-2">
                <Text variant="small-strong" color="secondary">
                  Actions
                </Text>
                {events.length > 0 && (
                  <Text variant="small" color="tertiary">
                    {events.length}
                  </Text>
                )}
              </div>
            </div>
            {events.length === 0 && !isFinished ? (
              <div className="content-card-body run-actions-placeholder">
                <Text variant="small" color="tertiary">
                  {latestStatus?.detail ?? "Starting run…"}
                </Text>
              </div>
            ) : (
              <ActionsTimeline
                scrollRef={actionsBodyRef}
                events={events}
                selectedActionIndex={selectedActionIndex}
                onSelectAction={handleSelectAction}
              />
            )}
          </div>
        </div>

        <div className="detail-rail detail-rail--card">
          <RunStatusHeader
            running={!isFinished}
            status={result?.status}
            startedAt={startedAt}
            finishedAt={result?.finishedAt}
            agentProvider={agentProvider}
            agentModel={agentModel}
          />
          {!isFinished && (
            <RunVariablesSection
              variables={run?.variableOverrides ?? result?.variableOverrides}
            />
          )}
          {!isFinished && (
            <LiveScreenshotsSection
              runId={runId}
              selected={selectedShot}
              onSelectedChange={setSelectedShot}
              onPathsChange={handlePathsChange}
            />
          )}
          {isFinished && result && (
            <ResultPanel
              runId={runId}
              result={result}
              selected={selectedShot}
              onSelectedChange={setSelectedShot}
            />
          )}
        </div>
      </div>
    </ScrollArea>
  );
}

// ---------- read-only historical run view ----------
function HistoricalRunView({
  runId,
  record,
}: {
  runId: string;
  record: RunRecord;
}) {
  const events = filterTimelineEvents(record.events);
  const screenshotPaths = galleryPathsForResult(runId, record);
  const pathsKey = screenshotPaths.join("\0");
  const eventsKey = events.map((e) => `${e.seq}:${e.status}`).join(",");
  const [selectedShot, setSelectedShot] = useRunScreenshotIndex(
    runId,
    screenshotPaths.length,
  );
  const [selectedActionIndex, setSelectedActionIndex] = React.useState(0);
  const skipActionSyncRef = React.useRef(false);

  React.useEffect(() => {
    if (skipActionSyncRef.current) {
      skipActionSyncRef.current = false;
      return;
    }
    const collapsed = collapseEvents(events);
    if (collapsed.length === 0) {
      setSelectedActionIndex(0);
      return;
    }
    setSelectedActionIndex(
      actionIndexForScreenshot(selectedShot, collapsed, screenshotPaths),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- eventsKey/pathsKey
  }, [selectedShot, eventsKey, pathsKey]);

  function handleSelectAction(index: number) {
    const collapsed = collapseEvents(events);
    setSelectedActionIndex(index);
    if (screenshotPaths.length > 0) {
      skipActionSyncRef.current = true;
      setSelectedShot(screenshotIndexForAction(index, collapsed, screenshotPaths));
    }
  }

  return (
    <ScrollArea
      toolbar={
        <Toolbar titlebar surface="main" seamless>
          <ToolbarRow inset="main" className="main-titlebar-row detail-view-toolbar">
            <ToolbarContent className="detail-view-toolbar-content">
              <ToolbarTitle>{record.storyTitle}</ToolbarTitle>
            </ToolbarContent>
            <ToolbarActions className="detail-view-toolbar-actions">
              <ViewStoryButton storyName={record.storyName} />
              <RetryRunButton
                storyName={record.storyName}
                storyTitle={record.storyTitle}
                variableOverrides={record.variableOverrides}
              />
            </ToolbarActions>
          </ToolbarRow>
        </Toolbar>
      }
    >
      {/* Two-column run detail: action timeline on the left, status +
          assertions + screenshot on a right rail. */}
      <div className="detail-view run-detail-view">
        <div className="detail-view-main">
          <div className="content-card run-actions-card">
            <div className="content-card-header">
              <div className="flex min-w-0 items-center gap-2">
                <Text variant="small-strong" color="secondary">
                  Actions
                </Text>
                <Text variant="small" color="tertiary">
                  {events.length}
                </Text>
              </div>
            </div>
            <ActionsTimeline
              events={events}
              selectedActionIndex={selectedActionIndex}
              onSelectAction={handleSelectAction}
            />
          </div>
        </div>
        <div className="detail-rail detail-rail--card">
          <RunStatusHeader
            running={false}
            status={record.status}
            startedAt={record.startedAt}
            finishedAt={record.finishedAt}
            agentProvider={record.agentProvider}
            agentModel={record.agentModel}
          />
          <ResultPanel
            runId={runId}
            result={record}
            selected={selectedShot}
            onSelectedChange={setSelectedShot}
          />
        </div>
      </div>
    </ScrollArea>
  );
}

// ---------- exported view — used for /run/$runId (live) ----------
export function RunView() {
  const { runId } = useParams({ from: "/run/$runId" });
  return <LiveRunView runId={runId} />;
}

// ---------- exported view — used for /history/$runId (read-only) ----------
export function HistoryRunDetailView() {
  const { runId } = useParams({ from: "/history/$runId" });

  const recordQuery = useQuery({
    queryKey: ["runs:get", runId],
    queryFn: () => runsGet(runId),
    // Keep the previously-viewed run on screen while the next one loads so
    // switching history items doesn't flash the loading skeleton.
    placeholderData: keepPreviousData,
  });

  if (recordQuery.isLoading) {
    return (
      <ScrollArea title="Loading…">
        <div className="flex items-center gap-2 detail-view">
          <Loader2Icon className="size-4 animate-spin text-accent" />
          <Text variant="small" color="tertiary">
            Loading run…
          </Text>
        </div>
      </ScrollArea>
    );
  }

  if (recordQuery.isError || !recordQuery.data) {
    return (
      <ScrollArea title="Run not found">
        <div className="detail-view">
          <Text variant="small" color="tertiary">
            Could not load this run.
          </Text>
        </div>
      </ScrollArea>
    );
  }

  return <HistoricalRunView runId={runId} record={recordQuery.data} />;
}

// Export LiveRunView for potential re-use
export { LiveRunView };
