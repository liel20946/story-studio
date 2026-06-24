import * as React from "react";

// Persisted open/closed state for collapsible sections, keyed by a stable id.
// Story and run section collapse should survive remounts/navigation, so we back
// each section's open state with localStorage instead of `defaultOpen` (which
// resets every time the view mounts).
const STORAGE_KEY = "story-studio-collapse-v1";

function readAll(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

export function usePersistedCollapse(
  key: string,
  defaultOpen = true,
): [boolean, (open: boolean) => void] {
  const [open, setOpenState] = React.useState<boolean>(() => {
    const stored = readAll()[key];
    return stored ?? defaultOpen;
  });

  const setOpen = React.useCallback(
    (next: boolean) => {
      setOpenState(next);
      const all = readAll();
      all[key] = next;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
      } catch {
        // ignore quota / serialization failures — collapse state is non-critical
      }
    },
    [key],
  );

  return [open, setOpen];
}
