import * as React from "react";
import { agentGetAllCapabilities } from "./ipc";
import type { AgentCapabilities, AgentProvider } from "./contract-types";

interface AgentCapabilitiesStoreValue {
  codex: AgentCapabilities | null;
  claude: AgentCapabilities | null;
  ready: boolean;
  getCapabilities: (provider: AgentProvider) => AgentCapabilities | null;
}

const AgentCapabilitiesStoreContext =
  React.createContext<AgentCapabilitiesStoreValue | null>(null);

export function AgentCapabilitiesProvider({ children }: { children: React.ReactNode }) {
  const [codex, setCodex] = React.useState<AgentCapabilities | null>(null);
  const [claude, setClaude] = React.useState<AgentCapabilities | null>(null);
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;

    const load = () =>
      agentGetAllCapabilities()
        .then((snapshot) => {
          if (cancelled) return;
          setCodex(snapshot.codex);
          setClaude(snapshot.claude);
          setReady(true);
        })
        .catch(() => {
          if (!cancelled) setReady(true);
        });

    void load();
    let attempts = 0;
    const retry = window.setInterval(() => {
      if (cancelled) return;
      attempts += 1;
      if (attempts > 5) {
        window.clearInterval(retry);
        return;
      }
      void load();
    }, 1500);

    return () => {
      cancelled = true;
      window.clearInterval(retry);
    };
  }, []);

  const value = React.useMemo<AgentCapabilitiesStoreValue>(
    () => ({
      codex,
      claude,
      ready,
      getCapabilities: (provider) =>
        provider === "claude-code" ? claude : codex,
    }),
    [codex, claude, ready],
  );

  return (
    <AgentCapabilitiesStoreContext.Provider value={value}>
      {children}
    </AgentCapabilitiesStoreContext.Provider>
  );
}

export function useAgentCapabilities(provider: AgentProvider): AgentCapabilities | null {
  const store = React.useContext(AgentCapabilitiesStoreContext);
  if (!store) return null;
  return store.getCapabilities(provider);
}

export function useAgentCapabilitiesStore(): AgentCapabilitiesStoreValue {
  const store = React.useContext(AgentCapabilitiesStoreContext);
  if (!store) {
    throw new Error("useAgentCapabilitiesStore must be used within AgentCapabilitiesProvider");
  }
  return store;
}
