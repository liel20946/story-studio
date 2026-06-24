import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
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
  Input,
  Badge,
} from "@/components/ui";
import {
  generateCreate,
  generateGet,
  generateSend,
  generateSave,
  generateDiscard,
  onGenerateDraftUpdated,
  onGenerateSessionChanged,
} from "../lib/ipc";
import { ContentCard } from "../components/content-card";
import { ScreenshotImage } from "../components/screenshot-image";

export function GenerateView() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [sessionId, setSessionId] = React.useState<string | null>(null);
  const [url, setUrl] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [composer, setComposer] = React.useState("");
  const [previewTab, setPreviewTab] = React.useState<"preview" | "yaml" | "screenshots">("preview");

  const { data: session, refetch } = useQuery({
    queryKey: ["generate:get", sessionId],
    queryFn: () => generateGet(sessionId!),
    enabled: !!sessionId,
  });

  React.useEffect(() => {
    if (!sessionId) return;
    const u1 = onGenerateDraftUpdated(({ sessionId: id }) => {
      if (id === sessionId) refetch();
    });
    const u2 = onGenerateSessionChanged(() => refetch());
    return () => {
      u1();
      u2();
    };
  }, [sessionId, refetch]);

  const startMutation = useMutation({
    mutationFn: () => generateCreate(url, message || undefined),
    onSuccess: (detail) => {
      setSessionId(detail.sessionId);
      queryClient.setQueryData(["generate:get", detail.sessionId], detail);
      generateSend(detail.sessionId, message || `Explore ${url} and draft a focused UI story.`).then(() => refetch());
    },
  });

  const sendMutation = useMutation({
    mutationFn: (text: string) => generateSend(sessionId!, text),
    onSuccess: () => {
      setComposer("");
      refetch();
    },
  });

  const saveMutation = useMutation({
    mutationFn: () => generateSave(sessionId!),
    onSuccess: (res) => {
      navigate({ to: "/story/$name", params: { name: res.storyName } });
    },
  });

  const discardMutation = useMutation({
    mutationFn: () => generateDiscard(sessionId!),
    onSuccess: () => {
      setSessionId(null);
      setUrl("");
      setMessage("");
    },
  });

  const workflowLines = React.useMemo(() => {
    if (!session?.draftYaml) return [];
    const match = session.draftYaml.match(/workflow:\s*\|\s*\n([\s\S]*?)(?=\n\s*\w|$)/);
    if (!match) return [];
    return match[1]
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  }, [session?.draftYaml]);

  if (!sessionId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
        <Text variant="title" className="text-primary">Generate a story</Text>
        <Text variant="body" color="secondary" className="max-w-md text-center">
          AI explores the site and drafts a Bowser workflow. Chat to refine before saving.
        </Text>
        <div className="flex w-full max-w-md flex-col gap-2">
          <Input placeholder="https://example.com" value={url} onChange={(e) => setUrl(e.target.value)} />
          <Input
            placeholder="Optional focus (e.g. login flow)"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <Button
            variant="primary"
            disabled={!url.trim() || startMutation.isPending}
            onClick={() => startMutation.mutate()}
          >
            Start session
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col border-r border-separator">
        <Toolbar>
          <ToolbarRow>
            <ToolbarContent>
              <ToolbarTitle>Generate</ToolbarTitle>
              {session && (
                <Badge color="secondary" size="xs">{session.siteSlug}</Badge>
              )}
            </ToolbarContent>
            <ToolbarActions>
              <Button variant="ghost" size="medium" onClick={() => discardMutation.mutate()}>Discard</Button>
              <Button variant="primary" size="medium" onClick={() => saveMutation.mutate()} disabled={!session?.draftYaml}>Save</Button>
            </ToolbarActions>
          </ToolbarRow>
        </Toolbar>
        <ScrollArea className="flex-1 p-4">
          <div className="mx-auto flex max-w-2xl flex-col gap-3">
            {session?.messages.map((m) => (
              <div
                key={m.id}
                className={m.role === "user" ? "ml-8 rounded-card bg-well p-3" : "mr-8 rounded-card border border-separator p-3"}
              >
                <Text variant="mini" color="tertiary" className="mb-1 uppercase">{m.role}</Text>
                <Text variant="body" className="whitespace-pre-wrap text-secondary">{m.content}</Text>
              </div>
            ))}
            {session?.status === "running" && (
              <Text variant="mini" color="tertiary">Agent is working…</Text>
            )}
          </div>
        </ScrollArea>
        <div className="flex gap-2 border-t border-separator p-3">
          <Input
            className="flex-1"
            placeholder="Ask for changes…"
            value={composer}
            onChange={(e) => setComposer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && composer.trim()) {
                e.preventDefault();
                sendMutation.mutate(composer.trim());
              }
            }}
          />
          <Button
            variant="primary"
            disabled={!composer.trim() || sendMutation.isPending || session?.status === "running"}
            onClick={() => sendMutation.mutate(composer.trim())}
          >
            Send
          </Button>
        </div>
      </div>

      <div className="flex w-[380px] shrink-0 flex-col">
        <div className="flex gap-1 border-b border-separator p-2">
          {(["preview", "yaml", "screenshots"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              className={`rounded-control px-2 py-1 text-[11px] capitalize ${previewTab === tab ? "bg-well text-primary" : "text-tertiary"}`}
              onClick={() => setPreviewTab(tab)}
            >
              {tab}
            </button>
          ))}
        </div>
        <ScrollArea className="flex-1 p-3">
          {previewTab === "preview" && (
            <ContentCard title="Workflow">
              {workflowLines.length ? (
                <ol className="list-decimal space-y-1 pl-4 text-[12px] text-secondary">
                  {workflowLines.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ol>
              ) : (
                <Text variant="mini" color="tertiary">No draft yet</Text>
              )}
            </ContentCard>
          )}
          {previewTab === "yaml" && (
            <pre className="whitespace-pre-wrap font-mono text-[10px] text-secondary">
              {session?.draftYaml ?? "—"}
            </pre>
          )}
          {previewTab === "screenshots" && (
            <div className="flex flex-col gap-2">
              {session?.screenshotPaths?.length ? (
                session.screenshotPaths.map((p) => (
                  <ScreenshotImage key={p} path={p} />
                ))
              ) : (
                <Text variant="mini" color="tertiary">No screenshots yet</Text>
              )}
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  );
}
