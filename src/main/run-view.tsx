import * as React from "react";
import { useParams, useNavigate } from "@tanstack/react-router";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import {
  Link2Icon,
  MousePointer2Icon,
  TypeIcon,
  ScanLineIcon,
  ImageIcon,
  ClockIcon,
  CheckIcon,
  SparklesIcon,
  TerminalIcon,
  MessageSquareIcon,
  TextIcon,
  PlayIcon,
  CircleAlertIcon,
  Loader2Icon,
  CheckCircle2Icon,
  XCircleIcon,
  XIcon,
  CopyIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  BookOpenIcon,
  RotateCcwIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
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
  toast,
} from "@/components/ui";
import {
  runsGet,
  runCancel,
  runStart,
  clipboardWriteText,
  runsLiveScreenshots,
  runsLiveTimeline,
} from "../lib/ipc";
import { cn } from "@/lib/utils";
import { reportAppErrorFromUnknown } from "@/lib/app-error";
import type {
  RunEvent,
  RunEventKind,
  RunResult,
  RunRecord,
  RunStatus,
  AgentProvider,
} from "../lib/contract-types";
import { formatAgentModelLabel, formatAgentProviderLabel } from "../lib/agent-config";
import { useRegisterRun, useRun } from "../lib/run-store";
import { formatRunLogs } from "../lib/format-run-logs";
import {
  filterTimelineEvents,
  isActionEvent,
  pickLiveTimelineEvents,
} from "../lib/run-events";
import { useRunScreenshotIndex } from "../lib/use-run-screenshot-index";
import { ScreenshotImage, ScreenshotLightbox } from "../components/screenshot-image";
import { RailAssertionLine } from "../components/rail-assertion-line";

// ---------- copy run logs (toolbar action) ----------
function CopyLogsButton({
  runId,
  storyName,
  storyTitle,
  startedAt,
  events,
  result,
}: {
  runId: string;
  storyName?: string;
  storyTitle?: string;
  startedAt: number;
  events: RunEvent[];
  result?: RunResult | null;
}) {
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function handleCopy() {
    const text = formatRunLogs({
      runId,
      storyName: storyName ?? result?.storyName,
      storyTitle: storyTitle ?? result?.storyTitle,
      startedAt,
      events,
      result,
    });
    try {
      await clipboardWriteText(text);
      setCopied(true);
      toast.success("Run logs copied");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1200);
    } catch (err) {
      reportAppErrorFromUnknown("Failed to copy logs", err);
    }
  }

  return (
    <Button
      variant="glass"
      size="titlebar"
      onClick={handleCopy}
      aria-label="Copy run logs"
    >
      {copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
      Copy logs
    </Button>
  );
}

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
      const { runId, agentProvider, agentModel } = await runStart(
        storyName,
        variableOverrides,
      );
      registerRun(runId, storyName, storyTitle ?? storyName, {
        agentProvider,
        agentModel,
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

// ---------- icon map ----------
// Monochrome, thin-stroke icons — color comes from `.timeline-icon-wrap`.
function TimelineActionIcon({ icon: Icon }: { icon: LucideIcon }) {
  return <Icon className="size-3.5 shrink-0" strokeWidth={1.75} />;
}

function eventIcon(kind: RunEventKind): React.ReactNode {
  switch (kind) {
    case "navigate":
      return <TimelineActionIcon icon={Link2Icon} />;
    case "click":
      return <TimelineActionIcon icon={MousePointer2Icon} />;
    case "type":
      return <TimelineActionIcon icon={TypeIcon} />;
    case "snapshot":
      return <TimelineActionIcon icon={ScanLineIcon} />;
    case "screenshot":
      return <TimelineActionIcon icon={ImageIcon} />;
    case "wait":
      return <TimelineActionIcon icon={ClockIcon} />;
    case "assert":
      return <TimelineActionIcon icon={CheckIcon} />;
    case "evaluate":
      return <TimelineActionIcon icon={SparklesIcon} />;
    case "tool":
      return <TimelineActionIcon icon={TerminalIcon} />;
    case "message":
      return <TimelineActionIcon icon={MessageSquareIcon} />;
    case "reasoning":
      return <TimelineActionIcon icon={TextIcon} />;
    case "status":
      return <TimelineActionIcon icon={PlayIcon} />;
    case "error":
      return <TimelineActionIcon icon={CircleAlertIcon} />;
    default:
      return <TimelineActionIcon icon={TerminalIcon} />;
  }
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

// ---------- single timeline row ----------
function TimelineRow({ event, count = 1 }: { event: RunEvent; count?: number }) {
  const isProse = event.kind === "message" || event.kind === "reasoning";
  return (
    <div className="timeline-row group">
      <div className="timeline-icon-wrap">{eventIcon(event.kind)}</div>
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
    </div>
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
function LiveScreenshotsSection({ runId }: { runId: string }) {
  const { data } = useLiveRunScreenshotPaths(runId, true);
  const paths = data?.paths ?? [];
  const [selected, setSelected] = useRunScreenshotIndex(runId, paths.length, {
    defaultToLatest: false,
  });
  const [revealing, setRevealing] = React.useState(false);
  const prevLatestRef = React.useRef<string | undefined>(undefined);

  React.useEffect(() => {
    prevLatestRef.current = undefined;
  }, [runId]);

  React.useEffect(() => {
    if (paths.length === 0) return;
    const latest = paths[paths.length - 1];
    if (latest !== prevLatestRef.current) {
      prevLatestRef.current = latest;
      setSelected(paths.length - 1);
      setRevealing(true);
      const timer = setTimeout(() => setRevealing(false), 480);
      return () => clearTimeout(timer);
    }
  }, [paths, setSelected]);

  return (
    <Section title="Screenshots">
      {paths.length > 0 ? (
        <div className={cn("screenshot-reveal", revealing && "screenshot-reveal--active")}>
          <ScreenshotsGallery
            runId={runId}
            paths={paths}
            selected={selected}
            onSelectedChange={setSelected}
          />
        </div>
      ) : null}
    </Section>
  );
}

// ---------- result panel: Assertions + step-linked screenshots ----------
function ResultPanel({ runId, result }: { runId: string; result: RunResult }) {
  const cancelled = result.status === "cancelled";
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
  const displayPaths =
    galleryPaths.length > 0
      ? galleryPaths
      : result.screenshotPath
        ? [result.screenshotPath]
        : [];
  const viewingReady = result.runId === runId;
  const galleryPathsForView = viewingReady ? displayPaths : [];
  const [selected, setSelected] = useRunScreenshotIndex(runId, galleryPathsForView.length);

  return (
    <>
      <Section title="Assertions">
        <div className="flex flex-col">
          {result.assertions.map((a, i) => (
            <RailAssertionLine key={i} text={a.text} passed={a.passed} />
          ))}
        </div>
      </Section>

      {!cancelled && viewingReady && (
        <Section title="Screenshots">
          <ScreenshotsGallery
            runId={runId}
            paths={galleryPathsForView}
            selected={selected}
            onSelectedChange={setSelected}
          />
        </Section>
      )}
    </>
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
              <CopyLogsButton
                runId={runId}
                storyName={run?.storyName}
                storyTitle={run?.storyTitle}
                startedAt={startedAt}
                events={events}
                result={result}
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
              <div ref={actionsBodyRef} className="content-card-body run-actions-card-body">
                {collapseEvents(events).map(({ event, count }) => (
                  <TimelineRow
                    key={`${event.seq}-${event.runId}`}
                    event={event}
                    count={count}
                  />
                ))}
              </div>
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
          {!isFinished && <LiveScreenshotsSection runId={runId} />}
          {isFinished && result && <ResultPanel runId={runId} result={result} />}
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
              <CopyLogsButton
                runId={record.runId}
                storyName={record.storyName}
                storyTitle={record.storyTitle}
                startedAt={record.startedAt}
                events={record.events}
                result={record}
              />
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
            <div className="content-card-body run-actions-card-body">
              {collapseEvents(events).map(({ event, count }) => (
                <TimelineRow
                  key={`${event.seq}-${event.runId}`}
                  event={event}
                  count={count}
                />
              ))}
            </div>
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
          <ResultPanel runId={runId} result={record} />
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
