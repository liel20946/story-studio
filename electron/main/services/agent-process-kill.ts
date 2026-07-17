import type { ChildProcess } from "child_process";

/**
 * Kill a detached agent child and its process group (MCP servers, Computer Use
 * helpers, npx wrappers). Escalates to SIGKILL when the process is still alive.
 */
export function killDetachedAgentProcess(
  proc: ChildProcess | null | undefined,
  options?: {
    escalationMs?: number;
    isStillActive?: () => boolean;
    onEscalate?: () => void;
  },
): void {
  if (!proc) return;

  const pid = proc.pid ?? 0;
  const killGroup = (sig: NodeJS.Signals) => {
    try {
      if (pid) process.kill(-pid, sig);
      else proc.kill(sig);
    } catch {
      try {
        proc.kill(sig);
      } catch {
        // already dead
      }
    }
  };

  killGroup("SIGTERM");

  const escalationMs = options?.escalationMs ?? 2000;
  setTimeout(() => {
    if (options?.isStillActive && !options.isStillActive()) return;
    try {
      if (pid) process.kill(pid, 0);
    } catch {
      return;
    }
    options?.onEscalate?.();
    killGroup("SIGKILL");
  }, escalationMs);
}
