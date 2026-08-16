import * as React from "react";
import { ExternalLinkIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui";
import { runsOpenInProvider } from "@/lib/ipc";
import { reportAppErrorFromUnknown } from "@/lib/app-error";
import type { AgentProvider } from "@/lib/contract-types";

export function OpenInProviderButton({
  runId,
  agentProvider,
  providerSessionId,
}: {
  runId: string;
  agentProvider?: AgentProvider;
  providerSessionId?: string;
}) {
  const [isOpening, setIsOpening] = React.useState(false);

  if (!runId || !agentProvider || !providerSessionId) return null;

  const label =
    agentProvider === "claude-code" ? "Open in Claude" : "Open in Codex";

  async function handleOpen() {
    if (isOpening) return;
    setIsOpening(true);
    try {
      await runsOpenInProvider(runId);
    } catch (err) {
      reportAppErrorFromUnknown(`Failed to ${label.toLowerCase()}`, err);
    } finally {
      setIsOpening(false);
    }
  }

  return (
    <Button
      variant="filled"
      size="titlebar"
      radius="full"
      onClick={handleOpen}
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
