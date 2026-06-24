import { useNavigate, useMatchRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Loader2Icon, CheckCircle2Icon, XCircleIcon, ClockIcon } from "lucide-react";
import {
  ScrollArea,
  Toolbar,
  ToolbarRow,
  ToolbarContent,
  ToolbarTitle,
  Text,
  Badge,
  EmptyState,
  Button,
} from "@/components/ui";
import { runsList } from "../lib/ipc";
import type { RunResult, RunStatus } from "../lib/contract-types";
import { cn } from "@/lib/utils";

function statusColor(
  status: RunStatus,
): "green" | "red" | "secondary" | "yellow" {
  switch (status) {
    case "passed":
      return "green";
    case "failed":
    case "error":
      return "red";
    case "cancelled":
      return "yellow";
    default:
      return "secondary";
  }
}

function formatRelative(epochMs: number): string {
  const secs = Math.floor((Date.now() - epochMs) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatDuration(startedAt: number, finishedAt: number): string {
  const secs = Math.floor((finishedAt - startedAt) / 1000);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function HistoryRow({
  run,
  onClick,
  selected,
}: {
  run: RunResult;
  onClick: () => void;
  selected: boolean;
}) {
  return (
    <button
      type="button"
      className={cn(
        "history-card-row",
        selected && "history-card-row-selected",
      )}
      onClick={onClick}
    >
      <div className="shrink-0">
        {run.status === "passed" ? (
          <CheckCircle2Icon className="size-4 text-support-green" />
        ) : run.status === "failed" || run.status === "error" ? (
          <XCircleIcon className="size-4 text-support-red" />
        ) : (
          <ClockIcon className="size-4 text-tertiary" />
        )}
      </div>

      <div className="flex flex-col gap-0.5 min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <Text variant="small-strong" color="primary" truncate className="min-w-0 flex-1">
            {run.storyTitle}
          </Text>
          <Badge color={statusColor(run.status)} size="small">
            {run.status}
          </Badge>
        </div>
        <div className="flex items-center gap-2 text-small text-tertiary">
          <span className="tabular-nums">{formatRelative(run.finishedAt)}</span>
          <span>·</span>
          <span className="tabular-nums">
            {formatDuration(run.startedAt, run.finishedAt)}
          </span>
        </div>
      </div>

      {/* Screenshot thumbnail */}
      {run.screenshotUrl && (
        <img
          src={run.screenshotUrl}
          alt=""
          className="shrink-0 size-10 rounded-md border border-separator object-cover"
        />
      )}
    </button>
  );
}

// Custom toolbar so the title shares the same horizontal gutter as the body
// content (pl-4 on top of the toolbar's base padding aligns it with px-6 rows).
const historyToolbar = (
  <Toolbar titlebar surface="main" seamless>
    <ToolbarRow inset="main">
      <ToolbarContent>
        <ToolbarTitle>Run History</ToolbarTitle>
      </ToolbarContent>
    </ToolbarRow>
  </Toolbar>
);

export function HistoryView() {
  const navigate = useNavigate();
  const matchRoute = useMatchRoute();

  const runsQuery = useQuery({
    queryKey: ["runs:list"],
    queryFn: runsList,
  });

  const runs = runsQuery.data ?? [];

  if (runsQuery.isLoading) {
    return (
      <ScrollArea toolbar={historyToolbar}>
        <div className="flex items-center gap-2 px-6 py-6">
          <Loader2Icon className="size-4 animate-spin text-tertiary" />
          <Text variant="small" color="tertiary">
            Loading history…
          </Text>
        </div>
      </ScrollArea>
    );
  }

  if (runsQuery.isError) {
    return (
      <ScrollArea toolbar={historyToolbar}>
        <div className="px-4 py-6">
          <Text variant="small" color="tertiary">
            Failed to load run history.
          </Text>
          <Button
            variant="filled"
            size="small"
            className="mt-2"
            onClick={() => runsQuery.refetch()}
          >
            Retry
          </Button>
        </div>
      </ScrollArea>
    );
  }

  return (
    <ScrollArea toolbar={historyToolbar}>
      {runs.length === 0 ? (
        <EmptyState
          title="No runs yet"
          description="Run a story to see its history here."
        />
      ) : (
        <div className="flex flex-col py-3">
          {runs.map((run) => {
            const selected = !!matchRoute({
              to: "/history/$runId",
              params: { runId: run.runId },
            });
            return (
              <HistoryRow
                key={run.runId}
                run={run}
                selected={selected}
                onClick={() =>
                  navigate({
                    to: "/history/$runId",
                    params: { runId: run.runId },
                  })
                }
              />
            );
          })}
        </div>
      )}
    </ScrollArea>
  );
}
