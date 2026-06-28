import * as React from "react";
import { CommandIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type ShortcutKey = "mod" | "shift" | "ctrl" | "alt" | "opt" | (string & {});

function ShiftKeyIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 12" fill="currentColor" className={className} aria-hidden>
      <path d="M6 1.25 10.75 6.75H7.75V10.75H4.25V6.75H1.25L6 1.25Z" />
    </svg>
  );
}

function Kbd({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <kbd
      className={cn(
        "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded bg-control px-1 text-[11px] font-semibold leading-none text-primary ring-1 ring-inset ring-field",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

function ShortcutKeyCap({ keyName }: { keyName: ShortcutKey }) {
  switch (keyName) {
    case "mod":
      return (
        <Kbd>
          <CommandIcon className="size-3 lucide-icon-strong" />
        </Kbd>
      );
    case "shift":
      return (
        <Kbd>
          <ShiftKeyIcon className="size-3" />
        </Kbd>
      );
    case "ctrl":
      return <Kbd>Ctrl</Kbd>;
    case "alt":
    case "opt":
      return <Kbd>⌥</Kbd>;
    default:
      return <Kbd>{keyName.length === 1 ? keyName.toUpperCase() : keyName}</Kbd>;
  }
}

export function KeyboardShortcut({ keys }: { keys: ShortcutKey[] }) {
  return (
    <span className="flex gap-1">
      {keys.map((key, index) => (
        <ShortcutKeyCap key={`${key}-${index}`} keyName={key} />
      ))}
    </span>
  );
}
