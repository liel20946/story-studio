import { useCallback, useEffect, useState } from "react";
import { setupCheck } from "./ipc";
import { reportAppErrorFromUnknown } from "./app-error";
import {
  SETUP_STATUS_CHANGED_EVENT,
  agentCliReady,
  getCachedSetupStatus,
  setCachedSetupStatus,
} from "./setup-status-cache";
import type { SetupStatus } from "./contract-types";

export function useSetupStatus() {
  const [status, setStatus] = useState<SetupStatus | null>(() =>
    getCachedSetupStatus(),
  );
  const [loading, setLoading] = useState(() => !getCachedSetupStatus());

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await setupCheck();
      setCachedSetupStatus(next);
      setStatus(next);
    } catch (err) {
      reportAppErrorFromUnknown("Setup check failed", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!getCachedSetupStatus()) {
      void refresh();
    }
    const onChanged = () => setStatus(getCachedSetupStatus());
    window.addEventListener(SETUP_STATUS_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(SETUP_STATUS_CHANGED_EVENT, onChanged);
  }, [refresh]);

  const { codex: codexReady, claude: claudeReady } = agentCliReady(status);

  return {
    status,
    loading,
    loaded: status !== null,
    refresh,
    codexReady,
    claudeReady,
  };
}
