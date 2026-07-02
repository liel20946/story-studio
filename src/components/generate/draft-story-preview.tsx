import * as React from "react";
import { cn } from "@/lib/utils";
import { parseDraftMd } from "@/lib/parse-draft-md";
import { buildVarColors } from "@/lib/story-var-colors";
import { RailAssertionLine } from "@/components/rail-assertion-line";
import { StorySteps } from "@/components/story-steps";

function PreviewSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="generate-draft-preview-section">
      <span className="section-label">{title}</span>
      {children}
    </div>
  );
}

export function DraftStoryPreview({
  body,
  expanded,
}: {
  body: string;
  expanded: boolean;
}) {
  const parsed = React.useMemo(() => parseDraftMd(body), [body]);

  if (!parsed) {
    return (
      <pre
        className={cn(
          "generate-draft-card-pre",
          expanded ? "generate-draft-card-pre--expanded" : "generate-draft-card-pre--preview",
        )}
      >
        {body}
      </pre>
    );
  }

  const varColors = buildVarColors(parsed.variables);
  const hasContent =
    parsed.variables.length > 0 ||
    parsed.steps.length > 0 ||
    parsed.assertions.length > 0;

  if (!hasContent) return null;

  return (
    <div
      className={cn(
        "generate-draft-card-preview",
        expanded ? "generate-draft-card-preview--expanded" : "generate-draft-card-preview--collapsed",
      )}
    >
      {parsed.variables.length > 0 ? (
        <PreviewSection title="Variables">
          <div className="flex flex-col">
            {parsed.variables.map((v) => (
              <div
                key={v.key}
                className="flex items-center gap-1.5 py-0.5 min-w-0"
              >
                <span
                  className={cn(
                    "w-[5.5rem] shrink-0 truncate font-mono text-[10px] leading-[13px]",
                    varColors.text[v.key] ?? "text-tertiary",
                  )}
                >
                  {v.key}
                </span>
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate font-mono text-[10px] leading-[13px]",
                    v.value ? "text-secondary" : "text-quaternary",
                  )}
                >
                  {v.value || "empty"}
                </span>
              </div>
            ))}
          </div>
        </PreviewSection>
      ) : null}

      {parsed.steps.length > 0 ? (
        <PreviewSection title="Steps">
          <StorySteps steps={parsed.steps} colorMap={varColors.chip} />
        </PreviewSection>
      ) : null}

      {parsed.assertions.length > 0 ? (
        <PreviewSection title="Assertions">
          <div className="flex flex-col">
            {parsed.assertions.map((assertion, i) => (
              <RailAssertionLine key={i} text={assertion} colorMap={varColors.chip} />
            ))}
          </div>
        </PreviewSection>
      ) : null}
    </div>
  );
}
