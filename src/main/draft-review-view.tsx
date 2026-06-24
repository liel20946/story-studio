import * as React from "react";
import { useParams, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ScrollArea,
  Toolbar,
  ToolbarRow,
  ToolbarContent,
  ToolbarTitle,
  ToolbarActions,
  Button,
  Text,
  Badge,
} from "@/components/ui";
import { draftsGet, draftsApprove, draftsDiscard } from "../lib/ipc";
import { ContentCard } from "../components/content-card";

export function DraftReviewView() {
  const { draftId } = useParams({ from: "/draft/$draftId" });
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["drafts:get", draftId],
    queryFn: () => draftsGet(draftId),
    enabled: !!draftId,
  });

  const approveMutation = useMutation({
    mutationFn: () => draftsApprove(draftId),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["stories:list"] });
      navigate({ to: "/story/$name", params: { name: res.storyName } });
    },
  });

  const discardMutation = useMutation({
    mutationFn: () => draftsDiscard(draftId),
    onSuccess: () => navigate({ to: "/" }),
  });

  if (isLoading || !data) {
    return (
      <div className="flex h-full items-center justify-center">
        <Text variant="body" color="secondary">Loading draft…</Text>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Toolbar>
        <ToolbarRow>
          <ToolbarContent>
            <ToolbarTitle>Review recorded story</ToolbarTitle>
            <Badge color="secondary" size="xs">{data.siteSlug}</Badge>
          </ToolbarContent>
          <ToolbarActions>
            <Button
              variant="ghost"
              size="medium"
              onClick={() => discardMutation.mutate()}
              disabled={discardMutation.isPending}
            >
              Discard
            </Button>
            <Button
              variant="primary"
              size="medium"
              onClick={() => approveMutation.mutate()}
              disabled={approveMutation.isPending}
            >
              Save to library
            </Button>
          </ToolbarActions>
        </ToolbarRow>
      </Toolbar>

      <ScrollArea className="flex-1">
        <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
          <ContentCard title="Draft preview">
            <pre className="whitespace-pre-wrap text-[12px] leading-relaxed text-secondary">
              {data.draftMd}
            </pre>
          </ContentCard>
          <ContentCard title="Workflow (YAML)">
            <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-secondary">
              {data.draftYaml}
            </pre>
          </ContentCard>
          {data.recordingSpec && (
            <ContentCard title="Raw recording">
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-tertiary">
                {data.recordingSpec.slice(0, 4000)}
              </pre>
            </ContentCard>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
