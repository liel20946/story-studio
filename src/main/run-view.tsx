import * as React from "react";
import { useParams } from "@tanstack/react-router";
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
  ImageOffIcon,
  CopyIcon,
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
import { runsGet, runCancel, runsScreenshot, clipboardWriteText } from "../lib/ipc";
import { cn } from "@/lib/utils";
import type {
  RunEvent,
  RunEventKind,
  RunResult,
  RunRecord,
  RunStatus,
} from "../lib/contract-types";
import { InlineCode } from "../components/inline-code";
import { useRun } from "../lib/run-store";
import { formatRunLogs } from "../lib/format-run-logs";
import { filterTimelineEvents } from "../lib/run-events";

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
      console.error("[RunView] clipboard:writeText failed", err);
      toast.error("Failed to copy logs");
    }
  }

  return (
    <Button
      variant="glass"
      size="small"
      onClick={handleCopy}
      aria-label="Copy run logs"
    >
      {copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
      Copy logs
    </Button>
  );
}

// ---------- status helpers (mirrors story-view) ----------
// ---------- status helpers (mirrors story-view) ----------
function statusColor(status: RunStatus): "green" | "red" | "secondary" {
  switch (status) {
    case "passed":
      return "green";
    case "cancelled":
      return "secondary";
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

// Collapse consecutive events that read as the same action (same kind + same
// detail + same label) into one row, so a run of identical "Thinking" rows —
// or any repeated action — shows once with a ×N count instead of stacking up.
// The merged row keeps the first event's identity but adopts the LAST event's
// status (so a still-running tail stays a spinner).
function collapseEvents(events: RunEvent[]): { event: RunEvent; count: number }[] {
  const groups: { event: RunEvent; count: number }[] = [];
  for (const event of events) {
    const prev = groups[groups.length - 1];
    if (
      prev &&
      prev.event.kind === event.kind &&
      prev.event.label === event.label &&
      (prev.event.detail ?? "") === (event.detail ?? "")
    ) {
      prev.count += 1;
      prev.event = { ...prev.event, status: event.status };
    } else {
      groups.push({ event, count: 1 });
    }
  }
  return groups;
}

// ---------- single timeline row ----------
function TimelineRow({ event, count = 1 }: { event: RunEvent; count?: number }) {
  const isProse = event.kind === "message" || event.kind === "reasoning";
  return (
    <div className="timeline-row group">
      <div className="timeline-icon-wrap">{eventIcon(event.kind)}</div>
      <span className="truncate text-[12px] font-medium leading-4 text-primary">
        {event.label}
        {count > 1 && (
          <span className="ml-1 tabular-nums text-tertiary">×{count}</span>
        )}
      </span>
      <span
        className={cn(
          "min-w-0 truncate text-[12px] leading-4 text-tertiary",
          !isProse && "font-mono",
        )}
      >
        {event.detail ?? ""}
      </span>
      <span className="flex shrink-0 items-center justify-end">
        {event.status === "running" ? (
          <Loader2Icon className="size-3.5 animate-spin text-tertiary" />
        ) : event.status === "ok" ? (
          <CheckCircle2Icon className="size-3.5 text-support-green" />
        ) : event.status === "failed" ? (
          <XCircleIcon className="size-3.5 text-support-red" />
        ) : null}
      </span>
    </div>
  );
}

// ---------- elapsed timer ----------
function ElapsedTimer({ startedAt }: { startedAt: number }) {
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
    <span className="tabular-nums text-[10px] leading-none text-tertiary">
      {m > 0 ? `${m}m ` : ""}
      {s}s
    </span>
  );
}

// ---------- screenshot with broken/missing fallback ----------
// The screenshot is loaded on demand over IPC as a base64 data URL (see the
// `runs:screenshot` handler) rather than via a custom protocol scheme — the
// scheme races the runtime's webview creation and fails to load most of the
// time. React Query keys the fetch by path, so state resets cleanly when
// navigating between runs (no sticky error from a previous failed load).
function ScreenshotImage({ path }: { path?: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["runs:screenshot", path],
    queryFn: () => runsScreenshot(path as string),
    enabled: !!path,
    staleTime: Infinity,
  });

  if (path && isLoading) {
    return (
      <div
        className="w-full animate-pulse rounded-card border border-separator bg-well"
        style={{ aspectRatio: "16 / 10" }}
      />
    );
  }

  if (!path || !data?.dataUrl) {
    return (
      <div className="flex flex-col items-center justify-center gap-1.5 rounded-card border border-separator bg-well py-8 text-center">
        <ImageOffIcon className="size-5 text-quaternary" />
        <span className="text-[11px] leading-[15px] text-tertiary">
          No screenshot available
        </span>
      </div>
    );
  }

  // Fill the screenshot rectangle: a fixed-aspect framed box that the image
  // covers edge-to-edge (top-aligned so the page header / action result shows),
  // instead of letterboxing inside a contain box.
  return (
    <div
      className="w-full overflow-hidden rounded-card border border-separator bg-well"
      style={{ aspectRatio: "16 / 10" }}
    >
      <img
        src={data.dataUrl}
        alt="Final run screenshot"
        className="size-full object-cover object-top"
      />
    </div>
  );
}

// ---------- run status header (status + time, like the story view) ----------
// Rendered as the FIRST thing in the run body, above the Actions section.
// While running it shows a blue "Running" badge + elapsed timer; once finished
// it shows the run status badge + relative time.
function RunStatusHeader({
  running,
  status,
  startedAt,
  finishedAt,
}: {
  running: boolean;
  status?: RunStatus;
  startedAt: number;
  finishedAt?: number;
}) {
  // Spacing mirrors the story view's status row exactly so the two views read
  // identically: gap-3 between the status group and the time, gap-1.5 inside
  // each group.
  return (
    <div className="run-rail-meta">
      {running ? (
        <>
          <Loader2Icon className="size-3 shrink-0 animate-spin text-support-blue" />
          <Badge color="blue" size="xs">
            Running
          </Badge>
          <ElapsedTimer startedAt={startedAt} />
        </>
      ) : (
        status && (
          <>
            <Badge color={statusColor(status)} size="xs">
              {statusLabel(status)}
            </Badge>
            {finishedAt != null && (
              <span className="inline-flex items-center gap-1 text-[10px] leading-none tabular-nums text-tertiary">
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

// ---------- result panel: Assertions (banner at end) + Screenshots ----------
function ResultPanel({ result }: { result: RunResult }) {
  const cancelled = result.status === "cancelled";
  return (
    <>
      <Section title="Assertions">
      <div className="flex flex-col">
        {result.assertions.length > 0 ? (
          result.assertions.map((a, i) => (
            <div key={i} className="flex items-start gap-1.5 py-0.5 min-w-0">
              <div className="min-w-0 flex-1 text-[11px] leading-[15px] text-secondary [&_code]:text-[10px]">
                <InlineCode text={a.text} />
              </div>
              <span className="mt-px flex w-3.5 shrink-0 items-start justify-end">
                {a.passed ? (
                  <CheckCircle2Icon className="size-3 text-support-green" />
                ) : (
                  <XCircleIcon className="size-3 text-support-red" />
                )}
              </span>
            </div>
          ))
        ) : (
          <Text variant="mini" color="tertiary" className="py-1">
            No assertions.
          </Text>
        )}
      </div>
      </Section>

      {/* Screenshots section — skipped for cancelled runs; broken/missing
          images fall back to an empty state instead of a broken-image icon. */}
      {!cancelled && (
        <Section title="Screenshots">
          <div className="py-1">
            <ScreenshotImage path={result.screenshotPath} />
          </div>
        </Section>
      )}
    </>
  );
}

// ---------- live run view (reads from the global run store) ----------
function LiveRunView({ runId }: { runId: string }) {
  // Run state lives in the app-root store so it survives navigation away from
  // and back to this view — the timeline keeps accumulating in the background.
  const run = useRun(runId);
  const events = filterTimelineEvents(run?.events ?? []);
  const result = run?.result ?? null;
  const startedAt = run?.startedAt ?? Date.now();
  const [isCancelling, setIsCancelling] = React.useState(false);
  const bottomRef = React.useRef<HTMLDivElement>(null);

  // Auto-scroll as events arrive
  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events.length]);

  async function handleCancel() {
    setIsCancelling(true);
    try {
      await runCancel(runId);
    } catch (err) {
      console.error("[RunView] run:cancel failed", err);
    } finally {
      setIsCancelling(false);
    }
  }

  const isFinished = result !== null;

  return (
    <ScrollArea
      autoScrollToBottom
      autoScrollDeps={[events.length]}
      toolbar={
        <Toolbar titlebar surface="main" seamless>
          <ToolbarRow inset="main" className="detail-view-toolbar">
            <ToolbarContent className="detail-view-toolbar-content">
              <ToolbarTitle>
                {run?.storyTitle || run?.result?.storyTitle || "Run"}
              </ToolbarTitle>
            </ToolbarContent>
            <ToolbarActions className="detail-view-toolbar-actions">
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
                  size="small"
                  onClick={handleCancel}
                  disabled={isCancelling}
                  aria-label="Cancel run"
                >
                  <XIcon className="size-4" />
                  Cancel
                </Button>
              )}
            </ToolbarActions>
          </ToolbarRow>
        </Toolbar>
      }
    >
      {/* Two-column run detail: the action timeline (main flow) on the left,
          status + assertions + screenshot on a right rail. */}
      <div className="detail-view">
        <div className="detail-view-main">
          <Section title="Actions">
            {events.length === 0 && !isFinished && (
              <div className="flex items-center gap-2 py-3">
                <Loader2Icon className="size-4 animate-spin text-tertiary" />
                <Text variant="small" color="tertiary">
                  Starting run…
                </Text>
              </div>
            )}

            {collapseEvents(events).map(({ event, count }) => (
              <TimelineRow
                key={`${event.seq}-${event.runId}`}
                event={event}
                count={count}
              />
            ))}
          </Section>
          <div ref={bottomRef} />
        </div>

        <div className="detail-rail detail-rail--card">
          <RunStatusHeader
            running={!isFinished}
            status={result?.status}
            startedAt={startedAt}
            finishedAt={result?.finishedAt}
          />
          {isFinished && result && <ResultPanel result={result} />}
        </div>
      </div>
    </ScrollArea>
  );
}

// ---------- read-only historical run view ----------
function HistoricalRunView({ record }: { record: RunRecord }) {
  return (
    <ScrollArea
      toolbar={
        <Toolbar titlebar surface="main" seamless>
          <ToolbarRow inset="main" className="detail-view-toolbar">
            <ToolbarContent className="detail-view-toolbar-content">
              <ToolbarTitle>{record.storyTitle}</ToolbarTitle>
            </ToolbarContent>
            <ToolbarActions className="detail-view-toolbar-actions">
              <CopyLogsButton
                runId={record.runId}
                storyName={record.storyName}
                storyTitle={record.storyTitle}
                startedAt={record.startedAt}
                events={record.events}
                result={record}
              />
            </ToolbarActions>
          </ToolbarRow>
        </Toolbar>
      }
    >
      {/* Two-column run detail: action timeline on the left, status +
          assertions + screenshot on a right rail. */}
      <div className="detail-view">
        <div className="detail-view-main">
          <Section title="Actions">
            {collapseEvents(filterTimelineEvents(record.events)).map(({ event, count }) => (
              <TimelineRow
                key={`${event.seq}-${event.runId}`}
                event={event}
                count={count}
              />
            ))}
          </Section>
        </div>
        <div className="detail-rail detail-rail--card">
          <RunStatusHeader
            running={false}
            status={record.status}
            startedAt={record.startedAt}
            finishedAt={record.finishedAt}
          />
          <ResultPanel result={record} />
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
          <Loader2Icon className="size-4 animate-spin text-tertiary" />
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

  return <HistoricalRunView record={recordQuery.data} />;
}

// Export LiveRunView for potential re-use
export { LiveRunView };
