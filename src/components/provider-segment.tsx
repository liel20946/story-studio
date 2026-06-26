import type { AgentProvider } from "@/lib/contract-types";
import { LabeledSegment } from "./labeled-segment";

const PROVIDER_OPTIONS = [
  { value: "codex" as const, label: "Codex" },
  { value: "claude-code" as const, label: "Claude Code" },
] as const;

export function ProviderSegment({
  value,
  onChange,
}: {
  value: AgentProvider;
  onChange: (value: AgentProvider) => void;
}) {
  return (
    <LabeledSegment
      value={value}
      options={PROVIDER_OPTIONS}
      onChange={onChange}
      ariaLabel="Agent provider"
      segmentClass="segment-control--labeled segment-control--provider"
    />
  );
}
