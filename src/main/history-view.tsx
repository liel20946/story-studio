import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  CheckIcon,
  XIcon,
  ClockIcon,
  HistoryIcon,
  ImageIcon,
  ChevronRightIcon,
} from "lucide-react";
import {
  Badge,
  Button,
  ScrollArea,
  Toolbar,
  ToolbarRow,
  ToolbarContent,
  ToolbarTitle,
  EmptyState,
} from "@/components/ui";
import { ScreenshotImage } from "@/components/screenshot-image";
import { runsList } from "../lib/ipc";
import { useAllRuns } from "../lib/run-store";
import { cn } from "@/lib/utils";
import type { RunResult, RunStatus } from "../lib/contract-types";

function statusBadgeColor(
  status: RunStatus,
): "green" | "red" | "neutral" | "yellow" | "blue" {
  switch (status) {
    case "passed":
      return "green";
    case "cancelled":
      return "neutral";
    case "blocked":
      return "yellow";
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
    case "blocked":
      return "Blocked";
  }
}

function formatRelative(epochMs: number): string {
  if (!Number.isFinite(epochMs) || epochMs <= 0) return "";
  const secs = Math.floor((Date.now() - epochMs) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  if (mins < 60) return rem > 0 ? `${mins}m ${rem}s` : `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hrs}h ${remMins}m` : `${hrs}h`;
}

function heroScreenshotPath(run: RunResult): string | undefined {
  if (run.screenshotPath) return run.screenshotPath;
  if (run.screenshotPaths?.length) return run.screenshotPaths[run.screenshotPaths.length - 1];
  return undefined;
}

type HistoryRow = RunResult & { isRunning?: boolean; isQueued?: boolean };

function HistoryRunCard({
  run,
  onOpen,
}: {
  run: HistoryRow;
  onOpen: () => void;
}) {
  const live = !!(run.isRunning || run.isQueued);
  const shot = heroScreenshotPath(run);
  const assertions = run.assertions ?? [];
  const passedCount = assertions.filter((a) => a.passed).length;
  const failedCount = assertions.filter((a) => !a.passed).length;
  const duration =
    !live && run.finishedAt > run.startedAt
      ? formatDuration(run.finishedAt - run.startedAt)
      : "";
  const when = formatRelative(live ? run.startedAt : run.finishedAt);
  const previewAssertions = assertions.slice(0, 3);

  return (
    <button type="button" className="history-run-card" onClick={onOpen}>
      <div className="history-run-card-shot">
        {shot ? (
          <ScreenshotImage
            path={shot}
            alt=""
            className="history-run-card-shot-img"
            fit="cover"
          />
        ) : (
          <div className="history-run-card-shot-empty">
            <ImageIcon className="size-5 text-quaternary" />
          </div>
        )}
      </div>

      <div className="history-run-card-body">
        <div className="history-run-card-top">
          <span className="history-run-card-title">{run.storyTitle}</span>
          {run.isQueued ? (
            <Badge color="yellow" size="xs">
              Queued
            </Badge>
          ) : run.isRunning ? (
            <Badge color="blue" size="xs">
              Running
            </Badge>
          ) : (
            <Badge color={statusBadgeColor(run.status)} size="xs">
              {statusBadgeLabel(run.status)}
            </Badge>
          )}
        </div>

        {(run.summary || previewAssertions.length > 0) && (
          <div className="history-run-card-mid">
            {run.summary ? (
              <p className="history-run-card-summary">{run.summary}</p>
            ) : null}
            {previewAssertions.length > 0 ? (
              <ul className="history-run-card-assertions">
                {previewAssertions.map((a, i) => (
                  <li
                    key={`${i}-${a.text.slice(0, 24)}`}
                    className={cn(
                      "history-run-card-assertion",
                      a.passed
                        ? "history-run-card-assertion--pass"
                        : "history-run-card-assertion--fail",
                    )}
                  >
                    {a.passed ? (
                      <CheckIcon className="size-3 shrink-0" />
                    ) : (
                      <XIcon className="size-3 shrink-0" />
                    )}
                    <span>{a.text}</span>
                  </li>
                ))}
                {assertions.length > previewAssertions.length ? (
                  <li className="history-run-card-assertion history-run-card-assertion--more">
                    +{assertions.length - previewAssertions.length} more
                  </li>
                ) : null}
              </ul>
            ) : null}
          </div>
        )}

        <div className="history-run-card-meta">
          {assertions.length > 0 ? (
            <span className="history-run-card-meta-item">
              <CheckIcon className="size-3 text-support-green" />
              {passedCount}
              {failedCount > 0 ? (
                <>
                  <XIcon className="ml-1.5 size-3 text-support-red" />
                  {failedCount}
                </>
              ) : null}
            </span>
          ) : null}
          {duration ? (
            <span className="history-run-card-meta-item">
              <ClockIcon className="size-3" />
              {duration}
            </span>
          ) : null}
          {when ? (
            <span className="history-run-card-meta-item history-run-card-meta-item--muted">
              {when}
            </span>
          ) : null}
          <ChevronRightIcon className="history-run-card-chevron size-3.5" />
        </div>
      </div>
    </button>
  );
}

export function HistoryOverviewView() {
  const navigate = useNavigate();
  const allRuns = useAllRuns();

  const runsQuery = useQuery({
    queryKey: ["runs:list"],
    queryFn: runsList,
  });

  const rows = React.useMemo((): HistoryRow[] => {
    const history = runsQuery.data ?? [];
    const activeInStore = Object.values(allRuns).filter((r) => r.result === null);
    const activeIds = new Set(activeInStore.map((r) => r.runId));

    const activeRows: HistoryRow[] = activeInStore.map((r) => ({
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

    const historyRows: HistoryRow[] = history
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

  const liveCount = rows.filter((r) => r.isRunning || r.isQueued).length;
  const passedCount = rows.filter(
    (r) => !r.isRunning && !r.isQueued && r.status === "passed",
  ).length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Toolbar>
        <ToolbarRow>
          <ToolbarContent>
            <ToolbarTitle>History</ToolbarTitle>
          </ToolbarContent>
        </ToolbarRow>
      </Toolbar>

      <ScrollArea className="min-h-0 flex-1">
        {rows.length === 0 ? (
          <EmptyState
            title="No runs yet"
            description="Run a story to see it here with screenshots and assertion results."
            placement="center"
            actions={
              <Button
                variant="accent"
                size="medium"
                radius="full"
                onClick={() => navigate({ to: "/stories" })}
              >
                <HistoryIcon className="size-4" />
                Run a story
              </Button>
            }
          />
        ) : (
          <div className="history-run-list">
            <p className="history-run-list-sub">
              {rows.length} {rows.length === 1 ? "run" : "runs"}
              {liveCount > 0 ? ` · ${liveCount} live` : ""}
              {passedCount > 0 ? ` · ${passedCount} passed` : ""}
            </p>
            <div className="history-run-list-items">
              {rows.map((run) => (
                <HistoryRunCard
                  key={run.runId}
                  run={run}
                  onOpen={() =>
                    navigate(
                      run.isRunning || run.isQueued
                        ? { to: "/run/$runId", params: { runId: run.runId } }
                        : {
                            to: "/history/$runId",
                            params: { runId: run.runId },
                          },
                    )
                  }
                />
              ))}
            </div>
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
