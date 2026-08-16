import * as React from "react";
import { ExternalLinkIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui";
import { runsOpenInProvider } from "@/lib/ipc";
import { reportAppErrorFromUnknown } from "@/lib/app-error";
import type { AgentProvider } from "@/lib/contract-types";

export function openInProviderLabel(agentProvider: AgentProvider): string {
  return agentProvider === "claude-code" ? "Open in Claude" : "Open in Codex";
}

export function useOpenInProvider({
  runId,
  agentProvider,
  providerSessionId,
}: {
  runId: string;
  agentProvider?: AgentProvider;
  providerSessionId?: string;
}) {
  const [isOpening, setIsOpening] = React.useState(false);
  const available = Boolean(runId && agentProvider && providerSessionId);
  const label = agentProvider ? openInProviderLabel(agentProvider) : "Open in provider";

  const open = React.useCallback(async () => {
    if (!available || isOpening) return;
    setIsOpening(true);
    try {
      await runsOpenInProvider(runId);
    } catch (err) {
      reportAppErrorFromUnknown(`Failed to ${label.toLowerCase()}`, err);
    } finally {
      setIsOpening(false);
    }
  }, [available, isOpening, label, runId]);

  return { available, label, isOpening, open };
}

export function OpenInProviderButton({
  runId,
  agentProvider,
  providerSessionId,
}: {
  runId: string;
  agentProvider?: AgentProvider;
  providerSessionId?: string;
}) {
  const { available, label, isOpening, open } = useOpenInProvider({
    runId,
    agentProvider,
    providerSessionId,
  });

  if (!available) return null;

  return (
    <Button
      variant="filled"
      size="titlebar"
      radius="full"
      onClick={() => void open()}
      disabled={isOpening}
      aria-label={label}
    >
      {isOpening ? (
        <Loader2Icon className="size-4 animate-spin" />
      ) : (
        <ExternalLinkIcon className="size-4" />
      )}
      {label}
    </Button>
  );
}
