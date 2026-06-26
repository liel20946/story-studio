import { useEffect, useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";

export function LabeledSegment<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  segmentClass = "segment-control--labeled",
  className,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
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
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            data-active={active ? "true" : undefined}
            onClick={() => {
              setActiveIndex(index);
              onChange(opt.value);
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
