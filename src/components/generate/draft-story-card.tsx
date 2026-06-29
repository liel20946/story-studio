import * as React from "react";
import { ChevronDownIcon, CopyIcon, CheckIcon } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import { clipboardWriteText } from "@/lib/ipc";
import { DraftStoryPreview } from "./draft-story-preview";

export function DraftStoryCard({
  title,
  body,
}: {
  title: string;
  body?: string;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const cardRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!body && expanded) setExpanded(false);
  }, [body, expanded]);

  async function handleCopy() {
    if (!body) return;
    try {
      await clipboardWriteText(body);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore
    }
  }

  function handleExpand() {
    setExpanded(true);
  }

  React.useLayoutEffect(() => {
    if (!expanded) return;
    const frame = requestAnimationFrame(() => {
      cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => cancelAnimationFrame(frame);
  }, [expanded]);

  return (
    <div
      ref={cardRef}
      className={cn("generate-draft-card", expanded && "generate-draft-card--expanded")}
    >
      <div className="generate-draft-card-header">
        <span className="generate-draft-card-label">Draft story</span>
        {body ? (
          <Button
            type="button"
            variant="transparent"
            size="small"
            iconOnly
            onClick={handleCopy}
            aria-label="Copy draft"
          >
            {copied ? (
              <CheckIcon className="size-3.5 text-support-green" />
            ) : (
              <CopyIcon className="size-3.5" />
            )}
          </Button>
        ) : null}
      </div>
      <div className="generate-draft-card-body">
        <p className="generate-draft-card-title">{title}</p>
        {body ? (
          <>
            <DraftStoryPreview body={body} expanded={expanded} />
            <button
              type="button"
              className={cn(
                "generate-draft-card-toggle",
                expanded && "generate-draft-card-toggle--bottom",
              )}
              onClick={() => (expanded ? setExpanded(false) : handleExpand())}
            >
              <ChevronDownIcon
                className={cn("size-3.5", expanded && "rotate-180")}
              />
              {expanded ? "Show less" : "Show more"}
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
