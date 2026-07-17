import * as React from "react";
import { useParams, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpenIcon, Loader2Icon } from "lucide-react";
import {
  ScrollArea,
  Toolbar,
  ToolbarRow,
  ToolbarContent,
  ToolbarTitle,
  ToolbarActions,
  Button,
  Text,
} from "@/components/ui";
import type { GenerateConversationSummary } from "@/lib/contract-types";
import {
  generateGet,
  generateSend,
  generateApprove,
  generateCancel,
  onGenerateChanged,
  onGenerateProgress,
} from "@/lib/ipc";
import { startNewGeneration } from "@/lib/start-generation";
import { reportAppErrorFromUnknown } from "@/lib/app-error";
import { cn } from "@/lib/utils";
import { SkillComposer } from "@/components/generate/skill-composer";
import { DraftApprovalQuestion } from "@/components/generate/draft-approval-panel";
import { ChatMessageList } from "@/components/generate/chat-message-list";
import { ChatModelPicker } from "@/components/generate/chat-model-picker";
import { useChatModelSelection } from "@/lib/chat-model-selection";
import { useAgentCapabilities } from "@/lib/agent-capabilities-store";
import { getCachedAppSettings } from "@/lib/settings-cache";
import { normalizeAppSettings } from "@/lib/app-settings";

const CREATING_STORY_MS = 1500;
const NAVIGATE_FADE_MS = 160;

function bootstrapStorageKey(conversationId: string): string {
  return `story-studio:generate-bootstrap:${conversationId}`;
}

function hasBootstrapStarted(conversationId: string): boolean {
  try {
    return sessionStorage.getItem(bootstrapStorageKey(conversationId)) === "1";
  } catch {
    return false;
  }
}

function markBootstrapStarted(conversationId: string): void {
  try {
    sessionStorage.setItem(bootstrapStorageKey(conversationId), "1");
  } catch {
    // ignore quota / private mode
  }
}

function GenerateEmptyStage({
  composer,
}: {
  composer: React.ReactNode;
}) {
  return (
    <div className="generate-empty-stage flex min-h-0 flex-1 flex-col items-center justify-center">
      <h2 className="generate-empty-title">What story should we generate ?</h2>
      <p className="generate-empty-sub">
        Paste a URL and describe the flow. Add login credentials if needed. We'll ask if not. Refine
        in chat anytime.
      </p>
      <div className="generate-empty-composer w-full">{composer}</div>
    </div>
  );
}

export function GenerateHomeView() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [composerText, setComposerText] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const provider = normalizeAppSettings(getCachedAppSettings()).agentProvider;
  const capabilities = useAgentCapabilities(provider);
  const chatModel = useChatModelSelection(capabilities);

  async function handleSend(text: string) {
    const trimmed = text.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    let conversationId: string | null = null;
    try {
      conversationId = await startNewGeneration();
      queryClient.invalidateQueries({ queryKey: ["generate:list"] });
      navigate({
        to: "/generate/$conversationId",
        params: { conversationId },
        state: { initialMessage: trimmed },
      });
    } catch (err) {
      reportAppErrorFromUnknown("Generation failed", err);
    } finally {
      setSubmitting(false);
    }
  }

  const composer = (
    <SkillComposer
      value={composerText}
      onChange={setComposerText}
      onSubmit={() => handleSend(composerText)}
      disabled={submitting}
      autoFocus
      layout="inline"
      below={
        <ChatModelPicker
          value={chatModel.selection}
          models={chatModel.models}
          efforts={chatModel.efforts}
          modelLabel={chatModel.modelLabel}
          effortLabel={chatModel.effortLabel}
          disabled={submitting}
          onChange={chatModel.setChatModelSelection}
        />
      }
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Toolbar titlebar surface="main" seamless>
        <ToolbarRow inset="main" className="main-titlebar-row" />
      </Toolbar>
      <GenerateEmptyStage composer={composer} />
    </div>
  );
}

function GenerateChatView({ conversationId }: { conversationId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [composerText, setComposerText] = React.useState("");
  const [feedback, setFeedback] = React.useState("");
  const [statusMessage, setStatusMessage] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [approving, setApproving] = React.useState(false);
  const [openingStoryName, setOpeningStoryName] = React.useState<string | null>(null);
  const [navigatingAway, setNavigatingAway] = React.useState(false);
  const [stopping, setStopping] = React.useState(false);
  const bootstrappedSendRef = React.useRef(hasBootstrapStarted(conversationId));
  const openStoryTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigateTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const provider = normalizeAppSettings(getCachedAppSettings()).agentProvider;
  const capabilities = useAgentCapabilities(provider);
  const chatModel = useChatModelSelection(capabilities);
  const modelSelectionRef = React.useRef(chatModel.selection);
  modelSelectionRef.current = chatModel.selection;
  const latestDraftRef = React.useRef<HTMLDivElement>(null);

  const initialMessage = useRouterState({
    select: (s) =>
      (s.location.state as { initialMessage?: string } | undefined)?.initialMessage,
  });

  const conversationQuery = useQuery({
    queryKey: ["generate:get", conversationId],
    queryFn: () => generateGet(conversationId),
  });

  const conversation =
    conversationQuery.data?.id === conversationId ? conversationQuery.data : undefined;
  const listTitle = queryClient
    .getQueryData<GenerateConversationSummary[]>(["generate:list"])
    ?.find((item) => item.id === conversationId)?.title;
  const isComplete = conversation?.status === "complete";
  const isGenerating = conversation?.generating ?? submitting;

  const modelPicker = (
    <ChatModelPicker
      value={chatModel.selection}
      models={chatModel.models}
      efforts={chatModel.efforts}
      modelLabel={chatModel.modelLabel}
      effortLabel={chatModel.effortLabel}
      disabled={isComplete || approving}
      onChange={chatModel.setChatModelSelection}
    />
  );

  const beginActivity = React.useCallback((message: string) => {
    setStatusMessage(message);
  }, []);

  const endActivity = React.useCallback(() => {
    setStatusMessage(null);
  }, []);

  React.useEffect(
    () => () => {
      if (openStoryTimerRef.current) clearTimeout(openStoryTimerRef.current);
      if (navigateTimerRef.current) clearTimeout(navigateTimerRef.current);
    },
    [],
  );

  React.useEffect(() => {
    const unsubChanged = onGenerateChanged(() => {
      queryClient.invalidateQueries({ queryKey: ["generate:list"] });
      queryClient.invalidateQueries({ queryKey: ["generate:get", conversationId] });
    });
    const unsubProgress = onGenerateProgress((progress) => {
      if (progress.conversationId === conversationId) {
        setStatusMessage(progress.message);
      }
    });
    return () => {
      unsubChanged();
      unsubProgress();
    };
  }, [conversationId, queryClient]);

  React.useEffect(() => {
    if (!isGenerating) {
      endActivity();
      return;
    }
    setStatusMessage((prev) => {
      if (prev) return prev;
      const hasDraft = conversation?.messages.some((m) => m.kind === "draft");
      return hasDraft ? "Reviewing your draft" : "Planning next moves";
    });
  }, [isGenerating, conversation?.messages, endActivity]);

  React.useEffect(() => {
    const msg = initialMessage?.trim();
    if (!msg || bootstrappedSendRef.current) return;

    if (conversationQuery.isPending) return;

    const hasUserMessage = conversation?.messages.some((m) => m.kind === "user");
    if (hasUserMessage || conversation?.generating) {
      bootstrappedSendRef.current = true;
      return;
    }

    bootstrappedSendRef.current = true;
    markBootstrapStarted(conversationId);
    navigate({
      to: "/generate/$conversationId",
      params: { conversationId },
      replace: true,
      state: {},
    });
    beginActivity("Planning next moves");
    setSubmitting(true);
    const modelOverride = modelSelectionRef.current;
    void generateSend(conversationId, msg, modelOverride)
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ["generate:get", conversationId] });
      })
      .catch((err) => {
        reportAppErrorFromUnknown("Generation failed", err);
        queryClient.invalidateQueries({ queryKey: ["generate:get", conversationId] });
      })
      .finally(() => setSubmitting(false));
  }, [
    conversationId,
    initialMessage,
    conversation,
    conversationQuery.isPending,
    beginActivity,
    queryClient,
    navigate,
  ]);

  async function handleSend(text: string, source: "composer" | "feedback" = "composer") {
    const trimmed = text.trim();
    if (!trimmed || isGenerating || isComplete) return;
    if (source === "composer") setComposerText("");
    else setFeedback("");
    setSubmitting(true);
    const hasDraft = conversation?.messages.some((m) => m.kind === "draft");
    beginActivity(hasDraft ? "Reviewing your draft" : "Planning next moves");
    try {
      await generateSend(conversationId, trimmed, chatModel.selection);
    } catch (err) {
      if (source === "composer") setComposerText(trimmed);
      else setFeedback(trimmed);
      reportAppErrorFromUnknown("Generation failed", err);
      queryClient.invalidateQueries({ queryKey: ["generate:get", conversationId] });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStop() {
    if (stopping) return;
    setStopping(true);
    endActivity();
    try {
      await generateCancel(conversationId);
      queryClient.invalidateQueries({ queryKey: ["generate:get", conversationId] });
      queryClient.invalidateQueries({ queryKey: ["generate:list"] });
    } catch (err) {
      reportAppErrorFromUnknown("Could not stop generation", err);
    } finally {
      setStopping(false);
      setSubmitting(false);
    }
  }

  async function handleApprove() {
    setApproving(true);
    try {
      const result = await generateApprove(conversationId);
      queryClient.invalidateQueries({ queryKey: ["stories:list"] });
      queryClient.invalidateQueries({ queryKey: ["generate:list"] });
      setApproving(false);
      setOpeningStoryName(result.storyName);
      openStoryTimerRef.current = setTimeout(() => {
        setNavigatingAway(true);
        navigateTimerRef.current = setTimeout(() => {
          navigate({ to: "/story/$name", params: { name: result.storyName } });
        }, NAVIGATE_FADE_MS);
      }, CREATING_STORY_MS);
    } catch (err) {
      reportAppErrorFromUnknown("Failed to approve story", err);
      setApproving(false);
    }
  }

  if (conversationQuery.isPending && !conversation) {
    const pendingMessage = initialMessage?.trim();
    return (
      <div className="flex h-full min-h-0 flex-col">
        <Toolbar titlebar surface="main" seamless>
          <ToolbarRow inset="main" className="main-titlebar-row detail-view-toolbar">
            <ToolbarContent className="detail-view-toolbar-content">
              <ToolbarTitle>{listTitle ?? "New generation"}</ToolbarTitle>
            </ToolbarContent>
          </ToolbarRow>
        </Toolbar>
        {pendingMessage ? (
          <ScrollArea className="min-h-0 flex-1" autoScrollToBottom>
            <ChatMessageList
              messages={[]}
              draftMd={undefined}
              pendingUserMessage={pendingMessage}
              statusMessage={statusMessage ?? "Planning next moves"}
            />
          </ScrollArea>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <Loader2Icon className="size-5 animate-spin text-accent" />
          </div>
        )}
      </div>
    );
  }

  if (!conversation) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6">
        <Text color="secondary">Conversation not found.</Text>
        <Button variant="secondary" size="small" onClick={() => navigate({ to: "/generate" })}>
          Back
        </Button>
      </div>
    );
  }

  const hasDraft = conversation.messages.some((m) => m.kind === "draft");
  const isCreatingStory = openingStoryName !== null;
  const isSettlingApproval = approving || isCreatingStory;
  const isChatMuted = approving || isComplete;
  const showApproval =
    conversation.status === "active" && hasDraft && !isGenerating && !isCreatingStory;
  const isEmptyChat = conversation.messages.length === 0;
  const showEmptyStage =
    isEmptyChat &&
    !isComplete &&
    !isGenerating &&
    !submitting &&
    !isSettlingApproval &&
    !initialMessage?.trim();
  const activeStatusMessage = approving
    ? "Approving draft…"
    : isCreatingStory
      ? "Creating story…"
      : isGenerating
        ? statusMessage ?? (hasDraft ? "Reviewing your draft" : "Planning next moves")
        : null;
  const pendingUserMessage =
    initialMessage?.trim() && !conversation.messages.some((m) => m.kind === "user")
      ? initialMessage.trim()
      : null;

  const composer = isComplete ? (
    <div className="generate-composer generate-composer-footnote px-4 py-3">
      <Text variant="mini" color="tertiary">
        This generation is complete.
        {conversation.storyName ? " Open the story from the toolbar." : ""}
      </Text>
    </div>
  ) : isCreatingStory ? (
    <SkillComposer
      value=""
      onChange={() => {}}
      onSubmit={() => {}}
      disabled
      layout="docked"
      showSkill={false}
    />
  ) : showApproval ? (
    <DraftApprovalQuestion
      feedback={feedback}
      onFeedbackChange={setFeedback}
      onApprove={handleApprove}
      onSubmitFeedback={() => handleSend(feedback, "feedback")}
      approving={approving}
      submitting={submitting}
    />
  ) : (
    <SkillComposer
      value={composerText}
      onChange={setComposerText}
      onSubmit={() => handleSend(composerText)}
      onStop={handleStop}
      stopping={isGenerating}
      disabled={approving}
      autoFocus
      layout={showEmptyStage ? "inline" : "docked"}
      showSkill={showEmptyStage}
      below={modelPicker}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Toolbar titlebar surface="main" seamless>
        <ToolbarRow inset="main" className="main-titlebar-row detail-view-toolbar">
          <ToolbarContent className="detail-view-toolbar-content">
            <ToolbarTitle>{conversation.title}</ToolbarTitle>
          </ToolbarContent>
          {isComplete && conversation.storyName ? (
            <ToolbarActions className="detail-view-toolbar-actions">
              <Button
                variant="filled"
                size="titlebar"
                radius="full"
                onClick={() =>
                  navigate({ to: "/story/$name", params: { name: conversation.storyName! } })
                }
              >
                <BookOpenIcon className="size-4" />
                View story
              </Button>
            </ToolbarActions>
          ) : null}
        </ToolbarRow>
      </Toolbar>

      {showEmptyStage ? (
        <GenerateEmptyStage composer={composer} />
      ) : (
        <div
          className={cn(
            "generate-chat-body min-h-0 flex-1",
            isChatMuted && "generate-chat-body--muted",
            isComplete && "generate-chat-body--complete",
            isCreatingStory && "generate-chat-body--creating",
            navigatingAway && "generate-chat-body--leaving",
            showApproval && "generate-chat-body--approval",
          )}
        >
          <ScrollArea
            className="min-h-0 flex-1"
            autoScrollToBottom={!showApproval}
            scrollAnchorRef={showApproval ? latestDraftRef : undefined}
            autoScrollDeps={[
              conversation.messages.length,
              activeStatusMessage,
              showApproval,
              conversation.draftMd,
            ]}
          >
            <ChatMessageList
              messages={conversation.messages}
              draftMd={conversation.draftMd}
              statusMessage={activeStatusMessage}
              pendingUserMessage={pendingUserMessage}
              latestDraftRef={latestDraftRef}
            />
          </ScrollArea>
          <div className="generate-chat-footer">{composer}</div>
        </div>
      )}
    </div>
  );
}

export function GenerateConversationRouteView() {
  const { conversationId } = useParams({ from: "/generate/$conversationId" });
  return <GenerateChatView key={conversationId} conversationId={conversationId} />;
}
