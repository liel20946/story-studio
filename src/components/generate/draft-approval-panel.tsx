import * as React from "react";
import { ArrowUpIcon, PencilIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function DraftApprovalQuestion({
  feedback,
  onFeedbackChange,
  onApprove,
  onSubmitFeedback,
  approving,
  submitting,
}: {
  feedback: string;
  onFeedbackChange: (value: string) => void;
  onApprove: () => void;
  onSubmitFeedback: () => void;
  approving?: boolean;
  submitting?: boolean;
}) {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const busy = approving || submitting;
  const canSubmit = !!feedback.trim() && !busy;

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (canSubmit) onSubmitFeedback();
    }
  }

  return (
    <div className="generate-composer generate-composer--docked generate-composer--question">
      <div className={cn("generate-question-box", busy && "generate-question-box--disabled")}>
        <p className="generate-question-title">Approve draft?</p>
        <div className="generate-question-options">
          <button
            type="button"
            className="generate-question-option"
            disabled={busy}
            onClick={onApprove}
          >
            <span className="generate-question-option-badge" aria-hidden>1</span>
            <span className="generate-question-option-label">
              {approving ? "Approving…" : "Yes, approve"}
            </span>
          </button>
          <div
            className={cn(
              "generate-question-option generate-question-option--input",
              feedback.length > 0 && "generate-question-option--active",
            )}
            onClick={() => textareaRef.current?.focus()}
          >
            <span
              className="generate-question-option-badge generate-question-option-badge--icon"
              aria-hidden
            >
              <PencilIcon className="size-2.5" strokeWidth={2} />
            </span>
            <textarea
              ref={textareaRef}
              value={feedback}
              onChange={(e) => onFeedbackChange(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={busy}
              rows={1}
              placeholder="Describe changes…"
              className="generate-question-text"
              aria-label="Describe changes"
            />
            <button
              type="button"
              className={cn("generate-send-btn", canSubmit && "generate-send-btn--ready")}
              disabled={!canSubmit}
              onClick={(e) => {
                e.stopPropagation();
                onSubmitFeedback();
              }}
              aria-label={submitting ? "Sending" : "Submit changes"}
            >
              <ArrowUpIcon className="generate-send-btn-icon" strokeWidth={2.5} absoluteStrokeWidth />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
