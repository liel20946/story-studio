import * as React from "react";
import { normalizeHexColor } from "@/lib/color-theme-config";
import { textOnColor } from "@/lib/color-utils";
import { ThemeColorPickerPopover } from "./theme-color-picker-popover";

export function ThemeColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const inputId = React.useId();
  const fieldRef = React.useRef<HTMLButtonElement>(null);
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState(value);

  React.useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = (next: string) => {
    const normalized = normalizeHexColor(next, value);
    setDraft(normalized);
    if (normalized !== value) {
      onChange(normalized);
    }
  };

  const fieldText = textOnColor(value);

  return (
    <div className="theme-color-row">
      <label className="theme-color-row-label" htmlFor={inputId}>
        {label}
      </label>
      <button
        ref={fieldRef}
        type="button"
        className="theme-color-field"
        style={{
          backgroundColor: value,
          color: fieldText,
          borderColor: `color-mix(in srgb, ${value} 70%, var(--color-border-field))`,
        }}
        onClick={() => setOpen((current) => !current)}
        aria-label={`${label} color`}
        aria-expanded={open}
      >
        <span className="theme-color-preview-ring" aria-hidden />
        <input
          id={inputId}
          className="theme-color-hex"
          value={draft}
          spellCheck={false}
          autoComplete="off"
          style={{ color: fieldText }}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => commit(draft)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter") {
              commit(draft);
              setOpen(false);
            }
            if (event.key === "Escape") {
              setDraft(value);
              setOpen(false);
            }
          }}
        />
      </button>
      {open ? (
        <ThemeColorPickerPopover
          value={value}
          anchorRef={fieldRef}
          onChange={(color) => {
            commit(color);
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}

export function ThemeContrastField({
  value,
  accent,
  onChange,
}: {
  value: number;
  accent: string;
  onChange: (value: number) => void;
}) {
  return (
    <ThemeSliderField
      label="Contrast"
      value={value}
      accent={accent}
      onChange={onChange}
    />
  );
}

function ThemeSliderField({
  label,
  value,
  accent,
  onChange,
  onCommit,
}: {
  label: string;
  value: number;
  accent: string;
  onChange: (value: number) => void;
  onCommit?: (value: number) => void;
}) {
  const sliderId = React.useId();

  const commit = (next: number) => {
    if (onCommit) {
      onCommit(next);
    } else {
      onChange(next);
    }
  };

  return (
    <div className="theme-color-row">
      <label className="theme-color-row-label" htmlFor={sliderId}>
        {label}
      </label>
      <div className="theme-contrast-control">
        <input
          id={sliderId}
          type="range"
          className="theme-contrast-slider"
          min={0}
          max={100}
          step={1}
          value={value}
          style={
            {
              "--theme-contrast-accent": accent,
              "--theme-contrast-fill": `${value}%`,
            } as React.CSSProperties
          }
          onInput={(event) => onChange(Number(event.currentTarget.value))}
          onChange={(event) => onChange(Number(event.target.value))}
          onPointerUp={(event) =>
            commit(Number((event.currentTarget as HTMLInputElement).value))
          }
          onPointerCancel={(event) =>
            commit(Number((event.currentTarget as HTMLInputElement).value))
          }
          onKeyUp={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              commit(Number((event.currentTarget as HTMLInputElement).value));
            }
          }}
        />
        <span className="theme-contrast-value">{value}</span>
      </div>
    </div>
  );
}
