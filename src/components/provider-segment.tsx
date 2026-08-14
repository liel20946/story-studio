import type { AgentProvider } from "@/lib/contract-types";
import { LabeledSegment } from "./labeled-segment";

export function ProviderSegment({
  value,
  onChange,
  codexAvailable = true,
  claudeAvailable = true,
}: {
  value: AgentProvider;
  onChange: (value: AgentProvider) => void;
  codexAvailable?: boolean;
  claudeAvailable?: boolean;
}) {
  const options = [
    {
      value: "codex" as const,
      label: "Codex",
      disabled: !codexAvailable,
      disabledReason: "Codex CLI is not installed. Install it in Setup.",
    },
    {
      value: "claude-code" as const,
      label: "Claude Code",
      disabled: !claudeAvailable,
      disabledReason: "Claude Code CLI is not installed. Install it in Setup.",
    },
  ];

  return (
    <LabeledSegment
      value={value}
      options={options}
      onChange={onChange}
      ariaLabel="Agent provider"
      segmentClass="segment-control--labeled segment-control--provider"
    />
  );
}
