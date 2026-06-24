import type { AgentProvider } from "@/lib/contract-types";
import codexIcon from "@/assets/providers/codex.png";
import claudeCodeIcon from "@/assets/providers/claude-code.png";

const PROVIDER_OPTIONS: {
  value: AgentProvider;
  label: string;
  icon: string;
}[] = [
  { value: "codex", label: "Codex", icon: codexIcon },
  { value: "claude-code", label: "Claude Code", icon: claudeCodeIcon },
];

export function ProviderSegment({
  value,
  onChange,
}: {
  value: AgentProvider;
  onChange: (value: AgentProvider) => void;
}) {
  const activeIndex = PROVIDER_OPTIONS.findIndex((opt) => opt.value === value);

  return (
    <div
      className="segment-control segment-control--labeled segment-control--provider shrink-0"
      role="tablist"
      aria-label="Agent provider"
      data-active-index={activeIndex}
    >
      <span className="segment-control-thumb" aria-hidden />
      {PROVIDER_OPTIONS.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            title={opt.label}
            data-active={active}
            onClick={() => onChange(opt.value)}
          >
            <img
              src={opt.icon}
              alt=""
              className="size-[18px] shrink-0 rounded-[5px]"
              draggable={false}
            />
            <span className="provider-segment-label">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
