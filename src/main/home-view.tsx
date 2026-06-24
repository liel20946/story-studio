import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  CircleDotIcon,
  ListChecksIcon,
  HistoryIcon,
  ChevronRightIcon,
} from "lucide-react";
import {
  ScrollArea,
  Toolbar,
  ToolbarRow,
  ToolbarContent,
  ToolbarTitle,
  Button,
  EmptyState,
} from "@/components/ui";
import { storiesList, runsList } from "../lib/ipc";
import { cn } from "@/lib/utils";

export function HomeView() {
  const navigate = useNavigate();

  const storiesQuery = useQuery({
    queryKey: ["stories:list"],
    queryFn: storiesList,
  });

  const runsQuery = useQuery({
    queryKey: ["runs:list"],
    queryFn: runsList,
  });

  const stories = storiesQuery.data ?? [];
  const recentRuns = (runsQuery.data ?? []).slice(0, 5);
  const hasStories = stories.length > 0;

  const homeToolbar = (
    <Toolbar titlebar surface="main" seamless>
      <ToolbarRow inset="main">
        <ToolbarContent>
          <ToolbarTitle>Story Studio</ToolbarTitle>
        </ToolbarContent>
      </ToolbarRow>
    </Toolbar>
  );

  if (!hasStories && !storiesQuery.isLoading) {
    return (
      <ScrollArea toolbar={homeToolbar}>
        <div className="home-prompt">
          <h1 className="home-prompt-title">What story should we record?</h1>
          <p className="home-prompt-sub">
            Capture browser flows as reusable stories, then run them anytime.
          </p>
          <div className="home-actions">
            <button
              type="button"
              onClick={() => navigate({ to: "/record" })}
              className="accent-cta"
            >
              <CircleDotIcon className="size-4" />
              Record story
            </button>
          </div>
        </div>
      </ScrollArea>
    );
  }

  return (
    <ScrollArea toolbar={homeToolbar}>
      <div className="home-prompt">
        <h1 className="home-prompt-title">What story should we run?</h1>
        <p className="home-prompt-sub">
          {stories.length} {stories.length === 1 ? "story" : "stories"} ·{" "}
          {runsQuery.data?.length ?? 0} runs
        </p>
        <div className="home-actions">
          <Button
            variant="accent"
            size="medium"
            radius="full"
            onClick={() => navigate({ to: "/record" })}
          >
            <CircleDotIcon className="size-4" />
            Record
          </Button>
          <Button
            variant="filled"
            size="medium"
            radius="full"
            onClick={() => navigate({ to: "/bulk-run" })}
          >
            <ListChecksIcon className="size-4" />
            Run stories
          </Button>
          <Button
            variant="filled"
            size="medium"
            radius="full"
            onClick={() => navigate({ to: "/history" })}
          >
            <HistoryIcon className="size-4" />
            History
          </Button>
        </div>
      </div>

      {recentRuns.length > 0 && (
        <div className="home-recent-section">
          <p className="section-label mb-2">Recent runs</p>
          <div className="home-recent-list">
            {recentRuns.map((run) => (
              <button
                key={run.runId}
                type="button"
                className="home-link-row w-full"
                onClick={() =>
                  navigate({
                    to: "/history/$runId",
                    params: { runId: run.runId },
                  })
                }
              >
                <span className="min-w-0 flex-1 truncate text-left text-[12px] leading-4">
                  {run.storyTitle}
                </span>
                <span
                  className={cn(
                    "justify-self-end text-[10px] leading-none tabular-nums",
                    run.status === "passed"
                      ? "text-support-green"
                      : run.status === "cancelled"
                        ? "text-tertiary"
                        : "text-support-red",
                  )}
                >
                  {run.status}
                </span>
                <ChevronRightIcon className="size-3 shrink-0 text-quaternary" />
              </button>
            ))}
          </div>
        </div>
      )}
    </ScrollArea>
  );
}
