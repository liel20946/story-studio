import { useEffect, useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui";

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
  const selectedIndex = Math.max(
    0,
    options.findIndex((opt) => opt.value === value),
  );
  const [activeIndex, setActiveIndex] = useState(selectedIndex);

  useEffect(() => {
    setActiveIndex(selectedIndex);
  }, [selectedIndex, value]);

  return (
    <div
      className={cn("segment-control shrink-0", segmentClass, className)}
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
        const active = value === opt.value;
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
