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

/**
 * Per-run screenshot carousel index — each run keeps its own position.
 *
 * setSelected does not clamp against the current pathCount: live screenshot
 * lists often update one render before the parent pathCount catches up, and
 * clamping there permanently stuck the gallery one behind the latest image.
 *
 * When defaultToLatest is on and pathCount grows while we were already on the
 * previous tip, advance to the new latest automatically.
 */
export function useRunScreenshotIndex(
  runId: string,
  pathCount: number,
  { defaultToLatest = true }: { defaultToLatest?: boolean } = {},
): [number, (index: number) => void] {
  const [selected, setSelectedState] = React.useState(() =>
    pathCount > 0
      ? (() => {
          const saved = runScreenshotIndexByRunId.get(runId);
          if (saved !== undefined) return clampIndex(saved, pathCount);
          return defaultIndex(pathCount, defaultToLatest);
        })()
      : 0,
  );

  React.useEffect(() => {
    if (pathCount <= 0) return;
    const saved = runScreenshotIndexByRunId.get(runId);
    if (saved === undefined) {
      setSelectedState(defaultIndex(pathCount, defaultToLatest));
      return;
    }
    // New screenshot arrived and we were on (or past) the previous latest —
    // keep following the tip during live runs.
    if (defaultToLatest && saved >= pathCount - 2) {
      const next = pathCount - 1;
      runScreenshotIndexByRunId.set(runId, next);
      setSelectedState(next);
      return;
    }
    setSelectedState(clampIndex(saved, pathCount));
  }, [runId, pathCount, defaultToLatest]);

  const setSelected = React.useCallback((index: number) => {
    const next = Math.max(0, index);
    runScreenshotIndexByRunId.set(runId, next);
    setSelectedState(next);
  }, [runId]);

  return [clampIndex(selected, pathCount), setSelected];
}
