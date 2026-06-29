import { useState, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  CircleDotIcon,
  ListChecksIcon,
  ChevronRightIcon,
  FolderPlusIcon,
  BotIcon,
  Loader2Icon,
} from "lucide-react";
import { Button, Dialog, Input, Badge } from "@/components/ui";
import { storiesList, runsList } from "../lib/ipc";
import { startNewGeneration } from "../lib/start-generation";
import { reportAppErrorFromUnknown } from "../lib/app-error";
import { useSections } from "../lib/sections-store";
import type { RunStatus } from "../lib/contract-types";

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
  const recentRuns = (runsQuery.data ?? []).slice(0, 3);
  const hasStories = stories.length > 0;
  const [startingGenerate, setStartingGenerate] = useState(false);

  async function handleGenerateNew() {
    setStartingGenerate(true);
    try {
      const id = await startNewGeneration();
      navigate({ to: "/generate/$conversationId", params: { conversationId: id } });
    } catch (err) {
      reportAppErrorFromUnknown("Failed to start generation", err);
    } finally {
      setStartingGenerate(false);
    }
  }

  if (!hasStories && !storiesQuery.isLoading) {
    return (
      <div className="home-shell">
        <div className="home-view">
          <div className="home-content">
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
              <button
                type="button"
                onClick={() => void handleGenerateNew()}
                disabled={startingGenerate}
                className="accent-cta accent-cta--secondary"
              >
                {startingGenerate ? (
                  <Loader2Icon className="size-4 animate-spin text-accent" />
                ) : (
                  <BotIcon className="size-4" />
                )}
                Generate story
              </button>
            </div>
          </div>
        </div>
        </div>
      </div>
    );
  }

  return (
    <div className="home-shell">
      <div className="home-view">
        <div className="home-content">
          <div className="home-prompt">
            <h1 className="home-prompt-title">What story should we run ?</h1>
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
                disabled={startingGenerate}
                onClick={() => void handleGenerateNew()}
              >
                {startingGenerate ? (
                  <Loader2Icon className="size-4 animate-spin text-accent" />
                ) : (
                  <BotIcon className="size-4" />
                )}
                Generate story
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
        </div>
      </div>

      <Dialog
        open={sectionDialogOpen}
        onOpenChange={setSectionDialogOpen}
        title="New Section"
        description="Group related stories together in the sidebar."
        fieldLabel="Section name"
        size="medium"
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
    </div>
  );
}
