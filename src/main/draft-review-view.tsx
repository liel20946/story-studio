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

function formatDraftPreview(md: string): string {
  return md
    .split("\n")
    .filter((line) => !line.startsWith("**Source Recording:**"))
    .join("\n")
    .trimEnd();
}

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
    <ScrollArea
      toolbar={
        <Toolbar titlebar surface="main" seamless>
          <ToolbarRow inset="main" className="detail-view-toolbar">
            <ToolbarContent className="detail-view-toolbar-content">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <ToolbarTitle>Review recorded story</ToolbarTitle>
                <Badge color="secondary" size="xs">{data.siteSlug}</Badge>
              </div>
            </ToolbarContent>
            <ToolbarActions className="detail-view-toolbar-actions">
              <Button
                variant="glass"
                size="medium"
                onClick={() => discardMutation.mutate()}
                disabled={discardMutation.isPending}
              >
                Discard
              </Button>
              <Button
                variant="accent"
                size="medium"
                radius="full"
                onClick={() => approveMutation.mutate()}
                disabled={approveMutation.isPending}
              >
                Save to library
              </Button>
            </ToolbarActions>
          </ToolbarRow>
        </Toolbar>
      }
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
        <ContentCard title="Draft preview">
          <pre className="whitespace-pre-wrap text-[12px] leading-relaxed text-secondary">
            {formatDraftPreview(data.draftMd)}
          </pre>
        </ContentCard>
      </div>
    </ScrollArea>
  );
}
