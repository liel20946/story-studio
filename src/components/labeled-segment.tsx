import { useEffect, useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/overlays";

export type SegmentOption<T extends string> = {
  value: T;
  label: string;
  disabled?: boolean;
  disabledReason?: string;
};

export function LabeledSegment<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  segmentClass = "segment-control--labeled",
  className,
}: {
  value: T;
  options: readonly SegmentOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  segmentClass?: string;
  className?: string;
}) {
  const selectedEnabledIndex = options.findIndex(
    (opt) => opt.value === value && !opt.disabled,
  );
  const [activeIndex, setActiveIndex] = useState(selectedEnabledIndex);

  useEffect(() => {
    setActiveIndex(selectedEnabledIndex);
  }, [selectedEnabledIndex, value]);

  return (
    <div
      className={cn(
        "segment-control shrink-0",
        segmentClass,
        className,
        selectedEnabledIndex < 0 && "segment-control--no-selection",
      )}
      role="tablist"
      aria-label={ariaLabel}
      data-active-index={activeIndex}
      style={
        {
          "--segment-active-index": String(activeIndex),
        } as CSSProperties
      }
    >
      <span className="segment-control-thumb" aria-hidden />
      {options.map((opt, index) => {
        const active = selectedEnabledIndex >= 0 && value === opt.value;
        const disabled = Boolean(opt.disabled);
        const button = (
          <button
            type="button"
            role="tab"
            aria-selected={active}
            aria-disabled={disabled || undefined}
            data-active={active ? "true" : undefined}
            disabled={disabled}
            onClick={() => {
              if (disabled) return;
              setActiveIndex(index);
              onChange(opt.value);
            }}
          >
            {opt.label}
          </button>
        );

        if (!disabled || !opt.disabledReason) {
          return <span key={opt.value}>{button}</span>;
        }

        return (
          <Tooltip key={opt.value}>
            <TooltipTrigger asChild>
              <span className="segment-control-option-disabled">{button}</span>
            </TooltipTrigger>
            <TooltipContent>{opt.disabledReason}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
