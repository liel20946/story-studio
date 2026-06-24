import { useState, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  CircleDotIcon,
  ListChecksIcon,
  ChevronRightIcon,
  FolderPlusIcon,
} from "lucide-react";
import {
  ScrollArea,
  Toolbar,
  ToolbarRow,
  ToolbarContent,
  ToolbarTitle,
  Button,
  EmptyState,
  Dialog,
  Input,
  Badge,
} from "@/components/ui";
import { storiesList, runsList } from "../lib/ipc";
import { useSections } from "../lib/sections-store";
import type { RunStatus } from "../lib/contract-types";

function statusBadgeColor(
  status: RunStatus,
): "green" | "red" | "secondary" {
  switch (status) {
    case "passed":
      return "green";
    case "cancelled":
      return "secondary";
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
  }
}

export function HomeView() {
  const navigate = useNavigate();
  const { createSection } = useSections();
  const [sectionDialogOpen, setSectionDialogOpen] = useState(false);
  const [sectionName, setSectionName] = useState("");

  useEffect(() => {
    if (sectionDialogOpen) setSectionName("");
  }, [sectionDialogOpen]);

  function handleCreateSection() {
    const name = sectionName.trim();
    if (!name) return;
    createSection(name);
    setSectionDialogOpen(false);
  }

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
            onClick={() => setSectionDialogOpen(true)}
          >
            <FolderPlusIcon className="size-4" />
            New section
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
                <span className="home-link-row-title">{run.storyTitle}</span>
                <span className="home-link-row-status">
                  <Badge color={statusBadgeColor(run.status)} size="xs">
                    {statusBadgeLabel(run.status)}
                  </Badge>
                </span>
                <ChevronRightIcon className="size-3 shrink-0 text-quaternary" />
              </button>
            ))}
          </div>
        </div>
      )}

      <Dialog
        open={sectionDialogOpen}
        onOpenChange={setSectionDialogOpen}
        title="New Section"
        confirmLabel="Create"
        confirmDisabled={!sectionName.trim()}
        onConfirm={handleCreateSection}
      >
        <Input
          autoFocus
          value={sectionName}
          placeholder="Section name"
          onChange={(e) => setSectionName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && sectionName.trim()) {
              e.preventDefault();
              handleCreateSection();
            }
          }}
        />
      </Dialog>
    </ScrollArea>
  );
}
