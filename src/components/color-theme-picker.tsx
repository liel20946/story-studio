import * as React from "react";
import { createPortal } from "react-dom";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  colorThemesForMode,
  getColorThemeDefinition,
  type ColorThemeId,
  type ThemeMode,
} from "@/lib/color-themes";
import { ESCAPE_DISMISS_LAYER_ATTR } from "@/lib/escape-key";

function ThemeSwatch({
  accent,
  className,
}: {
  accent: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "color-theme-swatch inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold leading-none",
        className,
      )}
      style={{
        backgroundColor: `color-mix(in srgb, ${accent} 18%, transparent)`,
        color: accent,
      }}
      aria-hidden
    >
      Aa
    </span>
  );
}

export function ColorThemePicker({
  value,
  mode,
  onChange,
}: {
  value: ColorThemeId;
  mode: ThemeMode;
  onChange: (value: ColorThemeId) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [menuStyle, setMenuStyle] = React.useState<React.CSSProperties>({});
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const itemRefs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const themes = colorThemesForMode(mode);
  const selected = getColorThemeDefinition(value);
  const selectedPalette = mode === "light" ? selected?.light : selected?.dark;
  const selectedName = selected?.name ?? "Raycast";
  const selectedIndex = Math.max(
    0,
    themes.findIndex((theme) => theme.id === value),
  );

  const displayAccent = selectedPalette?.accent ?? "#ff6363";

  const closeMenu = React.useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  const selectTheme = React.useCallback(
    (themeId: ColorThemeId) => {
      setOpen(false);
      triggerRef.current?.focus();
      if (themeId !== value) {
        onChange(themeId);
      }
    },
    [onChange, value],
  );

  const updateMenuPosition = React.useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const menuWidth = rect.width;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - menuWidth - 8));
    const top = rect.bottom + 6;
    const maxHeight = Math.min(220, Math.max(120, window.innerHeight - top - 12));

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

      if (!menuRef.current) return;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((current) => (current + 1) % themes.length);
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex(
          (current) => (current - 1 + themes.length) % themes.length,
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
        setActiveIndex(themes.length - 1);
        return;
      }

      if (event.key === "Enter" || event.key === " ") {
        const target = event.target as Node;
        if (!menuRef.current.contains(target)) {
          return;
        }
        event.preventDefault();
        const theme = themes[activeIndex];
        if (theme) {
          selectTheme(theme.id as ColorThemeId);
        }
      }
    };

    const onLayoutChange = () => {
      updateMenuPosition();
    };

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
  }, [activeIndex, closeMenu, open, selectTheme, themes, updateMenuPosition]);

  React.useLayoutEffect(() => {
    if (!open) return;
    itemRefs.current[activeIndex]?.focus({ preventScroll: true });
    itemRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  const menu = open ? (
    <div
      ref={menuRef}
      className="color-theme-menu"
      style={menuStyle}
      role="listbox"
      {...{ [ESCAPE_DISMISS_LAYER_ATTR]: "" }}
    >
      {themes.map((theme, index) => {
        const palette = mode === "light" ? theme.light : theme.dark;
        const themeId = theme.id as ColorThemeId;
        const isSelected = themeId === value;
        const isHighlighted = index === activeIndex;

        return (
          <button
            key={theme.id}
            ref={(node) => {
              itemRefs.current[index] = node;
            }}
            type="button"
            role="option"
            tabIndex={-1}
            aria-selected={isSelected}
            data-highlighted={isHighlighted ? "true" : undefined}
            className="color-theme-menu-item w-full"
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => selectTheme(themeId)}
          >
            <ThemeSwatch accent={palette.accent} />
            <span className="color-theme-menu-label">{theme.name}</span>
            {isSelected ? (
              <CheckIcon className="color-theme-menu-check" />
            ) : (
              <span className="color-theme-menu-check" aria-hidden />
            )}
          </button>
        );
      })}
    </div>
  ) : null;

  return (
    <div className="color-theme-picker-root relative">
      <button
        ref={triggerRef}
        type="button"
        className="color-theme-trigger"
        aria-label="Color theme"
        aria-expanded={open}
        aria-haspopup="listbox"
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            if (!open) {
              setActiveIndex((selectedIndex + 1) % themes.length);
              setOpen(true);
              requestAnimationFrame(updateMenuPosition);
            }
            return;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) {
              setActiveIndex(
                (selectedIndex - 1 + themes.length) % themes.length,
              );
              setOpen(true);
              requestAnimationFrame(updateMenuPosition);
            }
            return;
          }
          if (
            open &&
            (event.key === "Enter" || event.key === " ")
          ) {
            event.preventDefault();
            const theme = themes[activeIndex];
            if (theme) {
              selectTheme(theme.id as ColorThemeId);
            }
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
        <ThemeSwatch accent={displayAccent} />
        <span className="color-theme-trigger-label">{selectedName}</span>
        <ChevronDownIcon className="color-theme-trigger-chevron" />
      </button>
      {menu ? createPortal(menu, document.body) : null}
    </div>
  );
}
