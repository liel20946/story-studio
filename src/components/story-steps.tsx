import * as React from "react";
import { cn } from "@/lib/utils";
import { InlineCode } from "@/components/inline-code";
import { Text } from "@/components/ui";

const storyStepInputClass =
  "min-w-0 w-full bg-transparent border-0 outline-none p-0 text-inherit font-inherit leading-inherit focus:ring-1 focus:ring-field/60 rounded-sm";

export type StoryStepsProps = {
  steps: string[];
  colorMap?: Record<string, string>;
  editable?: boolean;
  stepInputRefs?: React.MutableRefObject<(HTMLInputElement | null)[]>;
  inputClassName?: string;
  onStepChange?: (index: number, value: string) => void;
  onStepKeyDown?: (
    e: React.KeyboardEvent<HTMLInputElement>,
    index: number,
    value: string,
  ) => void;
  onCommit?: () => void;
  className?: string;
};

export function StorySteps({
  steps,
  colorMap,
  editable = false,
  stepInputRefs,
  inputClassName,
  onStepChange,
  onStepKeyDown,
  onCommit,
  className,
}: StoryStepsProps) {
  return (
    <ol className={cn("story-steps-workflow", className)}>
      {steps.map((step, i) => (
        <li key={i} className="story-steps-workflow-item">
          <div className="story-steps-workflow-card">
            <span className="story-step-num" aria-hidden>
              {i + 1}
            </span>
            <div className="story-steps-workflow-content">
              {editable ? (
                <input
                  ref={(el) => {
                    if (stepInputRefs) stepInputRefs.current[i] = el;
                  }}
                  aria-label={`Step ${i + 1}`}
                  value={step}
                  onChange={(e) => onStepChange?.(i, e.target.value)}
                  onBlur={onCommit}
                  onKeyDown={(e) => onStepKeyDown?.(e, i, step)}
                  className={cn(
                    storyStepInputClass,
                    inputClassName ?? "text-[12px] leading-[16px] text-secondary",
                  )}
                />
              ) : (
                <Text variant="small" color="secondary">
                  <InlineCode text={step} colorMap={colorMap} />
                </Text>
              )}
            </div>
          </div>
          {i < steps.length - 1 ? (
            <div className="story-steps-workflow-connector" aria-hidden />
          ) : null}
        </li>
      ))}
    </ol>
  );
}
