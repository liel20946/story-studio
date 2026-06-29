import * as React from "react";
import { createPortal } from "react-dom";
import {
  hexToHsv,
  hexToRgb,
  hsvToHex,
  hueToHex,
  rgbToHex,
} from "@/lib/color-utils";
import { ESCAPE_DISMISS_LAYER_ATTR } from "@/lib/escape-key";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function ThemeColorPickerPopover({
  value,
  anchorRef,
  onChange,
  onClose,
}: {
  value: string;
  anchorRef: React.RefObject<HTMLElement | null>;
  onChange: (value: string) => void;
  onClose: () => void;
}) {
  const popoverRef = React.useRef<HTMLDivElement>(null);
  const svRef = React.useRef<HTMLDivElement>(null);
  const hueRef = React.useRef<HTMLDivElement>(null);
  const [hsv, setHsv] = React.useState(() => hexToHsv(value));
  const [dragging, setDragging] = React.useState<"sv" | "hue" | null>(null);
  const [style, setStyle] = React.useState<React.CSSProperties>({});

  React.useLayoutEffect(() => {
    setHsv(hexToHsv(value));
  }, [value]);

  const updatePosition = React.useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const width = 220;
    const left = Math.max(
      8,
      Math.min(rect.right - width, window.innerWidth - width - 8),
    );
    const top = rect.bottom + 8;
    setStyle({
      position: "fixed",
      top,
      left,
      width,
      zIndex: 1100,
    });
  }, [anchorRef]);

  React.useLayoutEffect(() => {
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [updatePosition]);

  React.useLayoutEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        popoverRef.current?.contains(target) ||
        anchorRef.current?.contains(target)
      ) {
        return;
      }
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [anchorRef, onClose]);

  const hsvRef = React.useRef(hsv);
  hsvRef.current = hsv;

  const commitHsv = React.useCallback(
    (next: { h: number; s: number; v: number }) => {
      hsvRef.current = next;
      setHsv(next);
      onChange(hsvToHex(next.h, next.s, next.v));
    },
    [onChange],
  );

  const updateSv = React.useCallback(
    (clientX: number, clientY: number) => {
      const node = svRef.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const s = clamp((clientX - rect.left) / rect.width, 0, 1);
      const v = clamp(1 - (clientY - rect.top) / rect.height, 0, 1);
      commitHsv({ ...hsvRef.current, s, v });
    },
    [commitHsv],
  );

  const updateHue = React.useCallback(
    (clientX: number) => {
      const node = hueRef.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const h = clamp(((clientX - rect.left) / rect.width) * 360, 0, 360);
      commitHsv({ ...hsvRef.current, h });
    },
    [commitHsv],
  );

  React.useEffect(() => {
    if (!dragging) return;
    const handleMove = (event: PointerEvent) => {
      if (dragging === "sv") updateSv(event.clientX, event.clientY);
      if (dragging === "hue") updateHue(event.clientX);
    };
    const handleUp = () => setDragging(null);
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [dragging, updateHue, updateSv]);

  const [r, g, b] = hexToRgb(hsvToHex(hsv.h, hsv.s, hsv.v));
  const hueColor = hueToHex(hsv.h);

  const popover = (
    <div
      ref={popoverRef}
      className="theme-color-picker-popover"
      style={style}
      role="dialog"
      aria-modal="true"
      aria-label="Color picker"
      {...{ [ESCAPE_DISMISS_LAYER_ATTR]: "" }}
    >
      <div
        ref={svRef}
        className="theme-color-picker-sv"
        style={{ backgroundColor: hueColor }}
        onPointerDown={(event) => {
          event.preventDefault();
          setDragging("sv");
          updateSv(event.clientX, event.clientY);
        }}
      >
        <div className="theme-color-picker-sv-white" />
        <div className="theme-color-picker-sv-black" />
        <span
          className="theme-color-picker-sv-thumb"
          style={{
            left: `${hsv.s * 100}%`,
            top: `${(1 - hsv.v) * 100}%`,
          }}
        />
      </div>
      <div className="theme-color-picker-controls">
        <span
          className="theme-color-picker-preview"
          style={{ backgroundColor: value }}
          aria-hidden
        />
        <div
          ref={hueRef}
          className="theme-color-picker-hue"
          onPointerDown={(event) => {
            event.preventDefault();
            setDragging("hue");
            updateHue(event.clientX);
          }}
        >
          <span
            className="theme-color-picker-hue-thumb"
            style={{ left: `${(hsv.h / 360) * 100}%` }}
          />
        </div>
      </div>
      <div className="theme-color-picker-rgb">
        <label className="theme-color-picker-rgb-field">
          <span>R</span>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={r}
            onChange={(event) => {
              const next = clamp(Number(event.target.value), 0, 255);
              commitHsv(hexToHsv(rgbToHex(next, g, b)));
            }}
          />
        </label>
        <label className="theme-color-picker-rgb-field">
          <span>G</span>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={g}
            onChange={(event) => {
              const next = clamp(Number(event.target.value), 0, 255);
              commitHsv(hexToHsv(rgbToHex(r, next, b)));
            }}
          />
        </label>
        <label className="theme-color-picker-rgb-field">
          <span>B</span>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={b}
            onChange={(event) => {
              const next = clamp(Number(event.target.value), 0, 255);
              commitHsv(hexToHsv(rgbToHex(r, g, next)));
            }}
          />
        </label>
      </div>
    </div>
  );

  return createPortal(popover, document.body);
}
