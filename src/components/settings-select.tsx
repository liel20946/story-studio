import * as React from "react";
import { createPortal } from "react-dom";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { ESCAPE_DISMISS_LAYER_ATTR } from "@/lib/escape-key";

export type SettingsSelectOption<T extends string = string> = {
  value: T;
  label: string;
};

export function SettingsSelect<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
}: {
  value: T;
  options: readonly SettingsSelectOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [menuStyle, setMenuStyle] = React.useState<React.CSSProperties>({});
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const itemRefs = React.useRef<(HTMLButtonElement | null)[]>([]);

  const selectedIndex = Math.max(
    0,
    options.findIndex((opt) => opt.value === value),
  );
  const selectedLabel =
    options.find((opt) => opt.value === value)?.label ?? value;

  const closeMenu = React.useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  const selectOption = React.useCallback(
    (next: T) => {
      setOpen(false);
      triggerRef.current?.focus();
      if (next !== value) onChange(next);
    },
    [onChange, value],
  );

  const updateMenuPosition = React.useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const menuWidth = Math.max(rect.width, 10.5 * 16);
    const left = Math.max(
      8,
      Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8),
    );
    const top = rect.bottom + 6;
    const maxHeight = Math.min(
      260,
      Math.max(120, window.innerHeight - top - 12),
    );

    setMenuStyle({
      position: "fixed",
      top,
      left,
      width: menuWidth,
      maxHeight,
      zIndex: 1000,
    });
  }, []);

  React.useLayoutEffect(() => {
    if (!open) return;
    updateMenuPosition();

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }
      closeMenu();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu();
        return;
      }

      if (!menuRef.current || options.length === 0) return;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((current) => (current + 1) % options.length);
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex(
          (current) => (current - 1 + options.length) % options.length,
        );
        return;
      }

      if (event.key === "Home") {
        event.preventDefault();
        setActiveIndex(0);
        return;
      }

      if (event.key === "End") {
        event.preventDefault();
        setActiveIndex(options.length - 1);
        return;
      }

      if (event.key === "Enter" || event.key === " ") {
        const target = event.target as Node;
        if (!menuRef.current.contains(target)) return;
        event.preventDefault();
        const option = options[activeIndex];
        if (option) selectOption(option.value);
      }
    };

    const onLayoutChange = () => updateMenuPosition();

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onLayoutChange);
    window.addEventListener("scroll", onLayoutChange, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onLayoutChange);
      window.removeEventListener("scroll", onLayoutChange, true);
    };
  }, [
    activeIndex,
    closeMenu,
    open,
    options,
    selectOption,
    updateMenuPosition,
  ]);

  React.useLayoutEffect(() => {
    if (!open) return;
    itemRefs.current[activeIndex]?.focus({ preventScroll: true });
    itemRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  const menu = open ? (
    <div
      ref={menuRef}
      className="settings-select-menu"
      style={menuStyle}
      role="listbox"
      aria-label={ariaLabel}
      {...{ [ESCAPE_DISMISS_LAYER_ATTR]: "" }}
    >
      {options.map((option, index) => {
        const isSelected = option.value === value;
        const isHighlighted = index === activeIndex;
        return (
          <button
            key={option.value}
            ref={(el) => {
              itemRefs.current[index] = el;
            }}
            type="button"
            role="option"
            aria-selected={isSelected}
            className={cn(
              "settings-select-item",
              isSelected && "settings-select-item--selected",
              isHighlighted && "settings-select-item--highlighted",
            )}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => selectOption(option.value)}
          >
            <span className="settings-select-item-label">{option.label}</span>
            {isSelected ? (
              <CheckIcon className="settings-select-item-check lucide-icon-strong" />
            ) : null}
          </button>
        );
      })}
    </div>
  ) : null;

  return (
    <div className={cn("settings-select-root relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        className="settings-select-trigger"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        onKeyDown={(event) => {
          if (options.length === 0) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            if (!open) {
              setActiveIndex((selectedIndex + 1) % options.length);
              setOpen(true);
              requestAnimationFrame(updateMenuPosition);
            }
            return;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) {
              setActiveIndex(
                (selectedIndex - 1 + options.length) % options.length,
              );
              setOpen(true);
              requestAnimationFrame(updateMenuPosition);
            }
            return;
          }
          if (open && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            const option = options[activeIndex];
            if (option) selectOption(option.value);
          }
        }}
        onClick={() => {
          setOpen((current) => {
            const next = !current;
            if (next) {
              setActiveIndex(selectedIndex);
              requestAnimationFrame(updateMenuPosition);
            }
            return next;
          });
        }}
      >
        <span className="settings-select-trigger-label">{selectedLabel}</span>
        <ChevronDownIcon className="settings-select-trigger-chevron" />
      </button>
      {menu ? createPortal(menu, document.body) : null}
    </div>
  );
}
