import * as React from "react";

const runScreenshotIndexByRunId = new Map<string, number>();

function clampIndex(index: number, pathCount: number): number {
  if (pathCount <= 0) return 0;
  return Math.min(Math.max(0, index), pathCount - 1);
}

function defaultIndex(pathCount: number, defaultToLatest: boolean): number {
  if (pathCount <= 0) return 0;
  return defaultToLatest ? pathCount - 1 : 0;
}

function readIndex(
  runId: string,
  pathCount: number,
  defaultToLatest: boolean,
): number {
  const saved = runScreenshotIndexByRunId.get(runId);
  if (saved !== undefined) {
    return clampIndex(saved, pathCount);
  }
  return defaultIndex(pathCount, defaultToLatest);
}

/** Per-run screenshot carousel index — each run keeps its own position. */
export function useRunScreenshotIndex(
  runId: string,
  pathCount: number,
  { defaultToLatest = true }: { defaultToLatest?: boolean } = {},
): [number, (index: number) => void] {
  const [selected, setSelectedState] = React.useState(() =>
    readIndex(runId, pathCount, defaultToLatest),
  );

  React.useEffect(() => {
    if (pathCount <= 0) return;
    setSelectedState(readIndex(runId, pathCount, defaultToLatest));
  }, [runId, pathCount, defaultToLatest]);

  const setSelected = React.useCallback(
    (index: number) => {
      const next = clampIndex(index, pathCount);
      runScreenshotIndexByRunId.set(runId, next);
      setSelectedState(next);
    },
    [runId, pathCount],
  );

  return [selected, setSelected];
}
