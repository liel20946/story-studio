import * as React from "react";
import { ChevronDownIcon, CopyIcon, CheckIcon } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import { clipboardWriteText } from "@/lib/ipc";

export function DraftStoryCard({
  title,
  summary,
  body,
}: {
  title: string;
  summary: string;
  body?: string;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const cardRef = React.useRef<HTMLDivElement>(null);

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
      cardRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
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
        <p className="generate-draft-card-summary">{summary}</p>
        {body ? (
          <>
            <pre
              className={cn(
                "generate-draft-card-pre",
                expanded ? "generate-draft-card-pre--expanded" : "generate-draft-card-pre--preview",
              )}
            >
              {body}
            </pre>
            <button
              type="button"
              className={cn(
                "generate-draft-card-toggle",
                expanded && "generate-draft-card-toggle--bottom",
              )}
              onClick={() => (expanded ? setExpanded(false) : handleExpand())}
            >
              <ChevronDownIcon
                className={cn("size-3.5 transition-transform", expanded && "rotate-180")}
              />
              {expanded ? "Show less" : "Show more"}
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
