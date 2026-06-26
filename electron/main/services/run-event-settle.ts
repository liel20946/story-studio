import { broadcast } from "../broadcast.js";
import type { RunEvent, RunStatus } from "./contract-types.js";

/** Map a finished run status to the timeline row status for in-flight events. */
export function settledEventStatus(runStatus: RunStatus): RunEvent["status"] {
  if (runStatus === "failed" || runStatus === "error") return "failed";
  if (runStatus === "cancelled") return "cancelled";
  return "ok";
}

/** Resolve any still-running timeline rows when a run finishes or is cancelled. */
export function settleRunningEvents(
  events: RunEvent[],
  runStatus: RunStatus,
  broadcastUpdates = true,
): void {
  const settled = settledEventStatus(runStatus);
  for (const e of events) {
    if (e.status === "running") {
      e.status = settled;
      if (broadcastUpdates) broadcast("run:event", { ...e });
    }
  }
}

/** Mark in-flight rows cancelled immediately when the user cancels a run. */
export function markRunCancelled(events: RunEvent[], runId: string, nextSeq: number): number {
  settleRunningEvents(events, "cancelled");
  const cancelEvent: RunEvent = {
    runId,
    seq: nextSeq,
    ts: Date.now(),
    kind: "status",
    label: "Cancelled",
    detail: "Cancelled by user",
    status: "cancelled",
  };
  events.push(cancelEvent);
  broadcast("run:event", cancelEvent);
  return nextSeq + 1;
}
