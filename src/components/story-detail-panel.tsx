import * as React from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { clipboardWriteText } from "@/lib/ipc";
import { reportAppErrorFromUnknown } from "@/lib/app-error";
import { stripCode, InlineCode } from "@/components/inline-code";
import { StorySteps } from "@/components/story-steps";

const storyEditInputClass =
  "min-w-0 w-full bg-transparent border-0 outline-none p-0 text-inherit font-inherit leading-inherit focus:ring-1 focus:ring-field/60 rounded-sm";

function CopyButton({ value, label }: { value: string; label: string }) {
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
      await clipboardWriteText(value);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1200);
    } catch (err) {
      reportAppErrorFromUnknown("Failed to copy variable", err);
    }
  }

  return (
    <button
      type="button"
      aria-label={label}
      onClick={handleCopy}
      className="flex items-center text-tertiary transition-colors hover:text-secondary"
    >
      {copied ? (
        <CheckIcon className="size-3.5 text-support-green" />
      ) : (
        <CopyIcon className="size-3.5" />
      )}
    </button>
  );
}

export function StoryDetailPanel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn("story-detail-layout", className)}>{children}</div>;
}

export function StoryDetailPanelSection({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("story-detail-section", className)}>
      <span className="section-label">{title}</span>
      {children}
    </section>
  );
}

export type StoryVariableRow = {
  key: string;
  value: string;
  secret?: boolean;
};

function isUndoShortcut(e: KeyboardEvent) {
  return (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !e.altKey;
}

function focusInputAt(refs: React.RefObject<(HTMLInputElement | null)[]>, index: number) {
  requestAnimationFrame(() => {
    refs.current[index]?.focus();
  });
}

function insertRow<T>(rows: T[], index: number, item: T): T[] {
  const next = [...rows];
  next.splice(index + 1, 0, item);
  return next;
}

function removeRow<T>(rows: T[], index: number): T[] {
  if (rows.length <= 1) return rows;
  return rows.filter((_, i) => i !== index);
}

function isBlankVariable(row: { key: string; value: string }) {
  return row.key.trim() === "" && row.value.trim() === "";
}

export function StoryVariableTable({
  variables,
  nameColors,
  editable = false,
  showCopy = false,
  keyInputRefs,
  valueInputRefs,
  onVariableChange,
  onVariablesChangeNow,
  onCommit,
}: {
  variables: StoryVariableRow[];
  nameColors: Record<string, string>;
  editable?: boolean;
  showCopy?: boolean;
  keyInputRefs?: React.MutableRefObject<(HTMLInputElement | null)[]>;
  valueInputRefs?: React.MutableRefObject<(HTMLInputElement | null)[]>;
  onVariableChange?: (variables: StoryVariableRow[]) => void;
  onVariablesChangeNow?: (variables: StoryVariableRow[]) => void;
  onCommit?: () => void;
}) {
  function handleVariableKeyDown(
    e: React.KeyboardEvent<HTMLInputElement>,
    index: number,
    field: "key" | "value",
  ) {
    if (!editable || !onVariablesChangeNow) return;
    if (isUndoShortcut(e.nativeEvent)) return;

    const row = variables[index];
    const value = field === "key" ? row.key : row.value;
    const refs = field === "key" ? keyInputRefs : valueInputRefs;
    if (!refs) return;

    if (e.key === "Enter") {
      e.preventDefault();
      onVariablesChangeNow(insertRow(variables, index, { key: "", value: "" }));
      if (keyInputRefs) focusInputAt(keyInputRefs, index + 1);
      return;
    }

    if (
      e.key === "Backspace" &&
      value === "" &&
      isBlankVariable(row) &&
      variables.length > 1
    ) {
      e.preventDefault();
      onVariablesChangeNow(removeRow(variables, index));
      focusInputAt(refs, Math.max(0, index - 1));
    }
  }

  function updateVariable(index: number, patch: Partial<StoryVariableRow>) {
    if (!onVariableChange) return;
    const next = [...variables];
    next[index] = { ...next[index], ...patch };
    onVariableChange(next);
  }

  return (
    <div className="story-var-table">
      <div className="story-var-table-head">
        <span>Key</span>
        <span>Value</span>
      </div>
      {variables.map((v, i) => {
        const key = stripCode(v.key);
        const value = stripCode(v.value);
        const showValue = !v.secret;

        return (
          <div key={editable ? i : key || i} className="story-var-table-row group/var">
            {editable ? (
              <>
                <input
                  ref={(el) => {
                    if (keyInputRefs) keyInputRefs.current[i] = el;
                  }}
                  aria-label={`Variable name ${i + 1}`}
                  value={v.key}
                  onChange={(e) => updateVariable(i, { key: e.target.value })}
                  onKeyDown={(e) => handleVariableKeyDown(e, i, "key")}
                  onBlur={onCommit}
                  className={cn(
                    storyEditInputClass,
                    "truncate font-mono text-[10px] leading-[13px]",
                    nameColors[v.key] ?? "text-tertiary",
                  )}
                />
                <input
                  ref={(el) => {
                    if (valueInputRefs) valueInputRefs.current[i] = el;
                  }}
                  aria-label={`Variable value ${v.key || i + 1}`}
                  value={v.value}
                  onChange={(e) => updateVariable(i, { value: e.target.value })}
                  onKeyDown={(e) => handleVariableKeyDown(e, i, "value")}
                  onBlur={onCommit}
                  className={cn(
                    storyEditInputClass,
                    "truncate font-mono text-[10px] leading-[13px] text-secondary",
                  )}
                />
              </>
            ) : (
              <>
                <span
                  className={cn(
                    "truncate font-mono text-[10px] leading-[13px]",
                    nameColors[key] ?? "text-tertiary",
                  )}
                >
                  {key}
                </span>
                <span className="flex min-w-0 items-center gap-1.5">
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate font-mono text-[10px] leading-[13px]",
                      value ? "text-secondary" : "text-quaternary",
                    )}
                  >
                    {value ? (showValue ? value : "••••••") : "empty"}
                  </span>
                  {showCopy && value ? (
                    <span className="shrink-0 opacity-0 transition-opacity group-hover/var:opacity-100">
                      <CopyButton value={value} label={`Copy ${key}`} />
                    </span>
                  ) : null}
                </span>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function StoryAssertionList({
  assertions,
  colorMap,
  editable = false,
  inputRefs,
  inputClassName,
  onAssertionChange,
  onAssertionKeyDown,
  onCommit,
}: {
  assertions: string[];
  colorMap?: Record<string, string>;
  editable?: boolean;
  inputRefs?: React.MutableRefObject<(HTMLInputElement | null)[]>;
  inputClassName?: string;
  onAssertionChange?: (index: number, value: string) => void;
  onAssertionKeyDown?: (
    e: React.KeyboardEvent<HTMLInputElement>,
    index: number,
    value: string,
  ) => void;
  onCommit?: () => void;
}) {
  if (assertions.length === 0) return null;

  return (
    <div className="story-assertion-block">
      {assertions.map((assertion, i) => (
        <div key={i} className="story-assertion-block-row">
          {editable ? (
            <input
              ref={(el) => {
                if (inputRefs) inputRefs.current[i] = el;
              }}
              aria-label={`Assertion ${i + 1}`}
              value={assertion}
              onChange={(e) => onAssertionChange?.(i, e.target.value)}
              onBlur={onCommit}
              onKeyDown={(e) => onAssertionKeyDown?.(e, i, assertion)}
              className={cn(
                storyEditInputClass,
                inputClassName ?? "text-[11px] leading-[15px] text-secondary text-center",
              )}
            />
          ) : (
            <div className="story-assertion-text text-[11px] leading-[15px] text-secondary [&_code]:text-[10px]">
              <InlineCode text={assertion} colorMap={colorMap} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export { storyEditInputClass };
