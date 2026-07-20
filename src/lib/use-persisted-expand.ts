import * as React from "react";

// Persisted "Show more" page depth for expandable sidebar lists. Without this,
// ExpandableRows resets to the first page whenever the tab unmounts or the app
// restarts — the same survival requirement as section collapse.
const STORAGE_KEY = "story-studio-expand-v1";

function readAll(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function sanitizeCount(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const n = Math.floor(value);
  return n >= fallback ? n : fallback;
}

export function usePersistedExpand(
  key: string,
  pageSize: number,
): [number, (next: number | ((prev: number) => number)) => void] {
  const [visible, setVisibleState] = React.useState<number>(() =>
    sanitizeCount(readAll()[key], pageSize),
  );

  // If the persist key changes (e.g. section remount with a new id), re-read.
  React.useEffect(() => {
    setVisibleState(sanitizeCount(readAll()[key], pageSize));
  }, [key, pageSize]);

  const setVisible = React.useCallback(
    (next: number | ((prev: number) => number)) => {
      setVisibleState((prev) => {
        const resolved = typeof next === "function" ? next(prev) : next;
        const sanitized = sanitizeCount(resolved, pageSize);
        const all = readAll();
        all[key] = sanitized;
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
        } catch {
          // ignore quota / serialization failures — expand state is non-critical
        }
        return sanitized;
      });
    },
    [key, pageSize],
  );

  return [visible, setVisible];
}
