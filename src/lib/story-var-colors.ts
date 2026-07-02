import { stripCode } from "@/components/inline-code";

/** Unified styling for variable names in the Variables rail. */
export const VAR_NAME_CLASS = "text-primary font-medium";

/** Unified styling for inline variable chips in steps/assertions. */
export const VAR_CHIP_CLASS =
  "bg-control-subtle text-primary ring-1 ring-inset ring-separator";

export function buildVarColors(variables: { key: string }[]) {
  const text: Record<string, string> = {};
  const chip: Record<string, string> = {};
  for (const v of variables) {
    const key = stripCode(v.key);
    if (!key) continue;
    text[key] = VAR_NAME_CLASS;
    chip[key] = VAR_CHIP_CLASS;
  }
  return { text, chip };
}
