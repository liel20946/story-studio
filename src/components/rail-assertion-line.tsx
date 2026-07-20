import { CheckCircle2Icon, XCircleIcon } from "lucide-react";
import { InlineCode } from "./inline-code";

export function RailAssertionLine({
  text,
  colorMap,
  passed,
}: {
  text: string;
  colorMap?: Record<string, string>;
  passed?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5 py-0.5 min-w-0">
      <div className="min-w-0 flex-1 truncate text-[12px] leading-[16px] text-secondary [&_code]:text-[12px]">
        <InlineCode text={text} colorMap={colorMap} />
      </div>
      {passed !== undefined && (
        <span className="flex w-3.5 shrink-0 items-center justify-end">
          {passed ? (
            <CheckCircle2Icon className="size-3 text-support-green" />
          ) : (
            <XCircleIcon className="size-3 text-support-red" />
          )}
        </span>
      )}
    </div>
  );
}
