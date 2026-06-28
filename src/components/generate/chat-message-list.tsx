import * as React from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import type { GenerateMessage } from "@/lib/contract-types";
import { clipboardWriteText } from "@/lib/ipc";
import { DraftStoryCard } from "./draft-story-card";
import { GenerateAgentActivity } from "./agent-activity";

function UserMessageBubble({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function handleCopy() {
    try {
      await clipboardWriteText(text);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore
    }
  }

  return (
    <div className="flex justify-end">
      <div className="generate-user-bubble group relative">
        <button
          type="button"
          onClick={handleCopy}
          aria-label="Copy message"
          className={`absolute right-full top-1/2 mr-1.5 -translate-y-1/2 rounded-md p-1 text-tertiary transition-opacity hover:text-secondary focus-visible:opacity-100 ${
            copied ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          }`}
        >
          {copied ? (
            <CheckIcon className="size-3.5 text-support-green" />
          ) : (
            <CopyIcon className="size-3.5" />
          )}
        </button>
        {text}
      </div>
    </div>
  );
}

export function ChatMessageList({
  messages,
  draftMd,
  statusMessage,
  pendingUserMessage,
}: {
  messages: GenerateMessage[];
  draftMd?: string;
  statusMessage?: string | null;
  pendingUserMessage?: string | null;
}) {
  const latestDraftIndex = messages.reduce(
    (acc, m, i) => (m.kind === "draft" ? i : acc),
    -1,
  );

  const hasUserMessage = messages.some((m) => m.kind === "user");

  return (
    <div className="generate-chat-thread">
      {pendingUserMessage && !hasUserMessage ? (
        <UserMessageBubble text={pendingUserMessage} />
      ) : null}
      {messages.map((message, index) => {
        if (message.kind === "user") {
          return <UserMessageBubble key={`${message.at}-${index}`} text={message.text} />;
        }
        if (message.kind === "status" || message.kind === "assistant") {
          return (
            <p key={`${message.at}-${index}`} className="generate-assistant-line">
              {message.text}
            </p>
          );
        }
        if (message.kind === "error") {
          return (
            <p key={`${message.at}-${index}`} className="generate-assistant-line">
              <span className="generate-assistant-error-label">Couldn't generate draft. </span>
              {message.text}
            </p>
          );
        }
        if (message.kind === "draft") {
          const isLatest = index === latestDraftIndex;
          return (
            <div key={`${message.at}-${index}`} className="generate-draft-block">
              <DraftStoryCard
                title={message.storyTitle}
                summary={message.summary}
                body={isLatest ? draftMd : undefined}
              />
            </div>
          );
        }
        return null;
      })}
      {statusMessage ? (
        <GenerateAgentActivity message={statusMessage} />
      ) : null}
    </div>
  );
}
