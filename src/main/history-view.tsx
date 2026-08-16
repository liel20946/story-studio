import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronRightIcon, HistoryIcon } from "lucide-react";
import { Badge, Button } from "@/components/ui";
import { runsList } from "../lib/ipc";
import { useAllRuns } from "../lib/run-store";
import type { RunResult, RunStatus } from "../lib/contract-types";

function statusBadgeColor(
  status: RunStatus,
): "green" | "red" | "neutral" {
  switch (status) {
    case "passed":
      return "green";
    case "cancelled":
      return "neutral";
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

type HistoryRow = RunResult & { isRunning?: boolean; isQueued?: boolean };

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
  const passedCount = rows.filter((r) => !r.isRunning && !r.isQueued && r.status === "passed").length;

  return (
    <div className="home-shell">
      <div className="home-view">
        <div className="home-content">
          <div className="home-prompt">
            <h1 className="home-prompt-title">Run history</h1>
            <p className="home-prompt-sub">
              {rows.length} {rows.length === 1 ? "run" : "runs"}
              {liveCount > 0 ? ` · ${liveCount} live` : ""}
              {passedCount > 0 ? ` · ${passedCount} passed` : ""}
            </p>
            {rows.length === 0 ? (
              <div className="home-actions">
                <Button
                  variant="accent"
                  size="medium"
                  radius="full"
                  onClick={() => navigate({ to: "/stories" })}
                >
                  <HistoryIcon className="size-4" />
                  Run a story
                </Button>
              </div>
            ) : null}
          </div>

          {rows.length > 0 ? (
            <div className="home-recent-section">
              <p className="section-label mb-2">All runs</p>
              <div className="home-recent-list">
                {rows.map((run) => (
                  <button
                    key={run.runId}
                    type="button"
                    className="home-link-row w-full"
                    onClick={() =>
                      navigate(
                        run.isRunning || run.isQueued
                          ? { to: "/run/$runId", params: { runId: run.runId } }
                          : {
                              to: "/history/$runId",
                              params: { runId: run.runId },
                            },
                      )
                    }
                  >
                    <span className="home-link-row-title">{run.storyTitle}</span>
                    <span className="home-link-row-status">
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
                    </span>
                    <span className="home-link-row-meta">
                      {formatRelative(
                        run.isRunning || run.isQueued
                          ? run.startedAt
                          : run.finishedAt,
                      )}
                    </span>
                    <ChevronRightIcon className="size-3 shrink-0 text-quaternary" />
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
