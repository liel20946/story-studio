import * as React from "react";
import { ArrowUpIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const SKILL_LABEL = "generate-story";
const DEFAULT_HINT =
  "Go to https://example.com and describe the flow you want…";
const FOLLOW_UP_HINT = "Send a follow-up…";

function ComposerActionButton({
  ready,
  stopping,
  onClick,
}: {
  ready?: boolean;
  stopping?: boolean;
  onClick: () => void;
}) {
  const active = ready || stopping;
  return (
    <button
      type="button"
      className={cn(
        "generate-send-btn",
        active && "generate-send-btn--ready",
        stopping && "generate-send-btn--stop",
      )}
      disabled={!active}
      onClick={onClick}
      aria-label={stopping ? "Stop" : "Send"}
    >
      {stopping ? (
        <span className="generate-send-btn-stop-mark" aria-hidden />
      ) : (
        <ArrowUpIcon className="generate-send-btn-icon lucide-icon-strong" absoluteStrokeWidth />
      )}
    </button>
  );
}

export function SkillComposer({
  value,
  onChange,
  onSubmit,
  onStop,
  stopping,
  disabled,
  autoFocus,
  layout = "docked",
  showSkill = true,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop?: () => void;
  stopping?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  /** `inline` — pill only (home / empty stage). `docked` — bottom footer chrome + pill. */
  layout?: "inline" | "docked";
  showSkill?: boolean;
  placeholder?: string;
}) {
  const hint = placeholder ?? (showSkill ? DEFAULT_HINT : FOLLOW_UP_HINT);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const prefixRef = React.useRef<HTMLSpanElement>(null);
  const hasDockChrome = layout === "docked";
  const isFirstPrompt = layout === "inline";
  const [prefixIndent, setPrefixIndent] = React.useState(0);
  const [isMultiline, setIsMultiline] = React.useState(false);

  React.useLayoutEffect(() => {
    if (!showSkill) {
      setPrefixIndent(0);
      return;
    }
    const prefix = prefixRef.current;
    if (!prefix) return;
    const gapPx = 6;
    const measure = () => setPrefixIndent(prefix.offsetWidth + gapPx);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(prefix);
    return () => observer.disconnect();
  }, [showSkill]);

  React.useEffect(() => {
    if (autoFocus) textareaRef.current?.focus();
  }, [autoFocus]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (stopping) {
        onStop?.();
        return;
      }
      if (!disabled && value.trim()) onSubmit();
    }
  }

  React.useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const lineHeight = Number.parseFloat(getComputedStyle(el).lineHeight);
    const maxHeight = isFirstPrompt ? 200 : 160;

    el.style.height = "0px";
    const scrollHeight = el.scrollHeight;
    const multiline =
      value.includes("\n") ||
      (value.length > 0 && Number.isFinite(lineHeight) && scrollHeight > lineHeight + 1);
    setIsMultiline(multiline);

    if (multiline) {
      el.style.height = `${Math.min(scrollHeight, maxHeight)}px`;
    } else if (Number.isFinite(lineHeight)) {
      el.style.height = `${lineHeight}px`;
    } else {
      el.style.height = "auto";
    }
  }, [value, isFirstPrompt]);

  const canSend = !disabled && !stopping && !!value.trim();
  const actionButton = (
    <ComposerActionButton
      ready={canSend}
      stopping={stopping}
      onClick={stopping ? () => onStop?.() : onSubmit}
    />
  );

  const inputRow = (
    <div
      className="generate-composer-input-row"
      style={{ "--skill-prefix-indent": `${prefixIndent}px` } as React.CSSProperties}
      onClick={() => !stopping && textareaRef.current?.focus()}
    >
      {showSkill ? (
        <span ref={prefixRef} className="generate-skill-prefix" aria-hidden>
          {SKILL_LABEL}
        </span>
      ) : null}
      {!value ? (
        <span className="generate-composer-hint" aria-hidden>
          {hint}
        </span>
      ) : null}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled || stopping}
        aria-label={hint}
        className="generate-composer-text"
      />
    </div>
  );

  return (
    <div
      className={cn(
        "generate-composer",
        hasDockChrome && "generate-composer--docked",
        isFirstPrompt && "generate-composer--prompt",
      )}
    >
      <div
        className={cn(
          "generate-composer-box",
          isFirstPrompt && "generate-composer-box--prompt",
          disabled && "generate-composer-box--disabled",
          stopping && "generate-composer-box--stopping",
        )}
      >
        {isFirstPrompt ? (
          <div className="generate-composer-stack">
            {inputRow}
            <div className="generate-composer-actions">{actionButton}</div>
          </div>
        ) : (
          <div
            className={cn(
              "generate-composer-inline",
              isMultiline && "generate-composer-inline--multiline",
            )}
          >
            {inputRow}
            {actionButton}
          </div>
        )}
      </div>
    </div>
  );
}
