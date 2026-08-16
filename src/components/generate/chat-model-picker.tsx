import * as React from "react";
import { createPortal } from "react-dom";
import { CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentModelOverride } from "@/lib/contract-types";
import { formatEffortLabel } from "@/lib/agent-config";

type OpenMenu = "model" | "effort" | null;

/** Keep thumb stops inset so the pill doesn't overlap Faster/Smarter labels. */
const EFFORT_SLIDER_INSET_PERCENT = 14;

function effortSliderPosition(index: number, count: number): number {
  if (count <= 1) return 50;
  const t = index / (count - 1);
  return EFFORT_SLIDER_INSET_PERCENT + t * (100 - 2 * EFFORT_SLIDER_INSET_PERCENT);
}

function useAnchoredMenu(
  open: boolean,
  anchorRef: React.RefObject<HTMLButtonElement | null>,
) {
  const [position, setPosition] = React.useState({ left: 0, bottom: 0 });

  React.useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      setPosition({
        left: rect.left,
        bottom: window.innerHeight - rect.top + 8,
      });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, anchorRef]);

  return position;
}

function PickerButton({
  label,
  disabled,
  ariaLabel,
  className,
  open,
  onClick,
  buttonRef,
}: {
  label: string;
  disabled?: boolean;
  ariaLabel: string;
  className?: string;
  open: boolean;
  onClick: () => void;
  buttonRef: React.RefObject<HTMLButtonElement | null>;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      disabled={disabled}
      aria-label={ariaLabel}
      aria-expanded={open}
      aria-haspopup="menu"
      className={cn(
        "generate-model-picker no-drag",
        className,
        open && "generate-model-picker--open",
        disabled && "generate-model-picker--disabled",
      )}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!disabled) onClick();
      }}
    >
      <span className="generate-model-picker-label">{label}</span>
    </button>
  );
}

function MenuPortal({
  open,
  anchorRef,
  className,
  children,
  onClose,
}: {
  open: boolean;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  className?: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const menuRef = React.useRef<HTMLDivElement>(null);
  const position = useAnchoredMenu(open, anchorRef);

  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (anchorRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const timer = window.setTimeout(() => {
      document.addEventListener("pointerdown", onPointerDown);
      document.addEventListener("keydown", onKeyDown);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, anchorRef, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      className={cn("generate-model-picker-menu no-drag", className)}
      style={{
        position: "fixed",
        left: position.left,
        bottom: position.bottom,
        zIndex: 10000,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

function ModelMenu({
  open,
  anchorRef,
  models,
  value,
  onSelect,
  onClose,
}: {
  open: boolean;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  models: Array<{ value: string; label: string }>;
  value: string;
  onSelect: (model: string) => void;
  onClose: () => void;
}) {
  return (
    <MenuPortal open={open} anchorRef={anchorRef} onClose={onClose}>
      <div className="generate-model-picker-heading">Models</div>
      {models.map((model) => {
        const selected = model.value === value;
        return (
          <button
            key={model.value}
            type="button"
            role="menuitem"
            className={cn(
              "generate-model-picker-item",
              selected && "generate-model-picker-item--selected",
            )}
            onClick={() => {
              onSelect(model.value);
              onClose();
            }}
          >
            <span className="generate-model-picker-item-label">{model.label}</span>
            {selected ? (
              <CheckIcon className="generate-model-picker-item-check lucide-icon-strong" />
            ) : null}
          </button>
        );
      })}
    </MenuPortal>
  );
}

function nearestEffortIndex(clientX: number, track: HTMLElement, count: number): number {
  if (count <= 1) return 0;
  const rect = track.getBoundingClientRect();
  if (rect.width <= 0) return 0;
  const inset = (EFFORT_SLIDER_INSET_PERCENT / 100) * rect.width;
  const usable = rect.width - 2 * inset;
  if (usable <= 0) return 0;
  const ratio = (clientX - rect.left - inset) / usable;
  return Math.max(0, Math.min(count - 1, Math.round(ratio * (count - 1))));
}

function EffortMenu({
  open,
  anchorRef,
  efforts,
  value,
  onSelect,
  onClose,
}: {
  open: boolean;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  efforts: string[];
  value: string;
  onSelect: (effort: string) => void;
  onClose: () => void;
}) {
  const trackRef = React.useRef<HTMLDivElement>(null);
  const draggingRef = React.useRef(false);
  const selectedIndex = Math.max(0, efforts.indexOf(value));
  // Local index only while dragging so the thumb follows the pointer before commit.
  const [dragIndex, setDragIndex] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (!open) {
      draggingRef.current = false;
      setDragIndex(null);
    }
  }, [open]);

  const displayIndex = dragIndex ?? selectedIndex;
  const displayEffort = efforts[displayIndex] ?? value;
  const thumbPosition = effortSliderPosition(displayIndex, efforts.length);

  const commitIndex = React.useCallback(
    (index: number) => {
      const effort = efforts[index];
      if (!effort) return;
      onSelect(effort);
    },
    [efforts, onSelect],
  );

  const indexFromClientX = React.useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track || efforts.length === 0) return selectedIndex;
      return nearestEffortIndex(clientX, track, efforts.length);
    },
    [efforts.length, selectedIndex],
  );

  const endDrag = React.useCallback(
    (clientX: number) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      const index = indexFromClientX(clientX);
      commitIndex(index);
      setDragIndex(null);
    },
    [commitIndex, indexFromClientX],
  );

  return (
    <MenuPortal
      open={open}
      anchorRef={anchorRef}
      className="generate-model-picker-menu--effort"
      onClose={onClose}
    >
      <div className="generate-effort-menu-header">
        <span className="generate-effort-menu-title">Effort</span>
        <span className="generate-effort-menu-current">
          {formatEffortLabel(displayEffort)}
        </span>
      </div>
      <div className="generate-effort-slider">
        <span className="generate-effort-slider-end">Faster</span>
        <div
          ref={trackRef}
          className={cn(
            "generate-effort-slider-track",
            dragIndex !== null && "generate-effort-slider-track--dragging",
          )}
          role="slider"
          tabIndex={0}
          aria-valuemin={0}
          aria-valuemax={Math.max(0, efforts.length - 1)}
          aria-valuenow={displayIndex}
          aria-valuetext={formatEffortLabel(displayEffort)}
          aria-label="Reasoning effort"
          style={
            {
              "--effort-slider-inset": `${EFFORT_SLIDER_INSET_PERCENT}%`,
            } as React.CSSProperties
          }
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            draggingRef.current = true;
            const index = indexFromClientX(event.clientX);
            setDragIndex(index);
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (!draggingRef.current) return;
            setDragIndex(indexFromClientX(event.clientX));
          }}
          onPointerUp={(event) => {
            if (!draggingRef.current) return;
            event.preventDefault();
            event.stopPropagation();
            try {
              event.currentTarget.releasePointerCapture(event.pointerId);
            } catch {
              // already released
            }
            endDrag(event.clientX);
          }}
          onPointerCancel={(event) => {
            endDrag(event.clientX);
          }}
          onKeyDown={(event) => {
            if (efforts.length === 0) return;
            let next = displayIndex;
            if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
              next = Math.max(0, displayIndex - 1);
            } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
              next = Math.min(efforts.length - 1, displayIndex + 1);
            } else if (event.key === "Home") {
              next = 0;
            } else if (event.key === "End") {
              next = efforts.length - 1;
            } else {
              return;
            }
            event.preventDefault();
            commitIndex(next);
          }}
        >
          <div className="generate-effort-slider-rail" aria-hidden />
          {efforts.map((effort, index) => {
            const position = effortSliderPosition(index, efforts.length);
            const active = index === displayIndex;
            return (
              <span
                key={effort}
                className={cn(
                  "generate-effort-slider-stop",
                  active && "generate-effort-slider-stop--active",
                )}
                style={{ left: `${position}%` }}
                aria-hidden
              />
            );
          })}
          <div
            className="generate-effort-slider-thumb"
            style={{ left: `${thumbPosition}%` }}
            aria-hidden
          />
        </div>
        <span className="generate-effort-slider-end">Smarter</span>
      </div>
    </MenuPortal>
  );
}

export function ChatModelPicker({
  value,
  modelLabel,
  effortLabel,
  models,
  efforts,
  disabled,
  onChange,
}: {
  value: AgentModelOverride;
  modelLabel: string;
  effortLabel: string;
  models: Array<{ value: string; label: string }>;
  efforts: string[];
  disabled?: boolean;
  onChange: (next: AgentModelOverride) => void;
}) {
  const [openMenu, setOpenMenu] = React.useState<OpenMenu>(null);
  const modelButtonRef = React.useRef<HTMLButtonElement>(null);
  const effortButtonRef = React.useRef<HTMLButtonElement>(null);

  const closeMenu = React.useCallback(() => setOpenMenu(null), []);

  const handleModelSelect = React.useCallback(
    (model: string) => {
      onChange({ model, effort: value.effort });
    },
    [onChange, value.effort],
  );

  const handleEffortSelect = React.useCallback(
    (effort: string) => {
      onChange({ model: value.model, effort });
    },
    [onChange, value.model],
  );

  return (
    <div className="generate-model-controls no-drag">
      <PickerButton
        buttonRef={modelButtonRef}
        label={modelLabel}
        disabled={disabled || models.length === 0}
        ariaLabel="Model"
        className="generate-model-picker--model"
        open={openMenu === "model"}
        onClick={() => setOpenMenu((current) => (current === "model" ? null : "model"))}
      />
      <ModelMenu
        open={openMenu === "model"}
        anchorRef={modelButtonRef}
        models={models}
        value={value.model}
        onSelect={handleModelSelect}
        onClose={closeMenu}
      />

      <PickerButton
        buttonRef={effortButtonRef}
        label={effortLabel}
        disabled={disabled || efforts.length === 0}
        ariaLabel="Reasoning effort"
        className="generate-model-picker--effort"
        open={openMenu === "effort"}
        onClick={() => setOpenMenu((current) => (current === "effort" ? null : "effort"))}
      />
      <EffortMenu
        open={openMenu === "effort"}
        anchorRef={effortButtonRef}
        efforts={efforts}
        value={value.effort}
        onSelect={handleEffortSelect}
        onClose={closeMenu}
      />
    </div>
  );
}
