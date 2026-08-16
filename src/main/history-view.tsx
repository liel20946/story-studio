import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { HistoryIcon } from "lucide-react";
import { Button, EmptyState } from "@/components/ui";
import { runsList } from "../lib/ipc";

/** `/history` landing — send users into a run detail (History is a sidebar tab). */
export function HistoryOverviewView() {
  const navigate = useNavigate();
  const runsQuery = useQuery({
    queryKey: ["runs:list"],
    queryFn: runsList,
  });

  React.useEffect(() => {
    const runs = runsQuery.data;
    if (!runs) return;
    if (runs.length > 0) {
      navigate({
        to: "/history/$runId",
        params: { runId: runs[0].runId },
        replace: true,
      });
    }
  }, [runsQuery.data, navigate]);

  if (runsQuery.isLoading) {
    return <div className="h-full" />;
  }

  if ((runsQuery.data ?? []).length === 0) {
    return (
      <EmptyState
        title="No runs yet"
        description="Run a story to see it in History."
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
    );
  }

  return <div className="h-full" />;
}
