import * as React from "react";
import { cn } from "@/lib/utils";
import { parseDraftMd } from "@/lib/parse-draft-md";
import { buildVarColors } from "@/lib/story-var-colors";
import {
  StoryDetailPanel,
  StoryDetailPanelSection,
  StoryVariableTable,
  StoryAssertionList,
} from "@/components/story-detail-panel";
import { StorySteps } from "@/components/story-steps";

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
      <StoryDetailPanel className="story-detail-layout--compact">
        {parsed.variables.length > 0 ? (
          <StoryDetailPanelSection title="Variables">
            <StoryVariableTable
              variables={parsed.variables}
              nameColors={varColors.text}
            />
          </StoryDetailPanelSection>
        ) : null}

        {parsed.steps.length > 0 ? (
          <StoryDetailPanelSection title="Steps">
            <StorySteps steps={parsed.steps} colorMap={varColors.chip} />
          </StoryDetailPanelSection>
        ) : null}

        {parsed.assertions.length > 0 ? (
          <StoryDetailPanelSection title="Assertions">
            <StoryAssertionList
              assertions={parsed.assertions}
              colorMap={varColors.chip}
            />
          </StoryDetailPanelSection>
        ) : null}
      </StoryDetailPanel>
    </div>
  );
}
