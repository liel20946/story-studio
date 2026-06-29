import { stripCode } from "@/components/inline-code";

export const VAR_PALETTE: { text: string; chip: string }[] = [
  { text: "text-support-blue", chip: "bg-support-blue-10 text-support-blue" },
  { text: "text-support-purple", chip: "bg-support-purple-10 text-support-purple" },
  { text: "text-support-green", chip: "bg-support-green-10 text-support-green" },
  { text: "text-support-orange", chip: "bg-support-orange-10 text-support-orange" },
  { text: "text-support-red", chip: "bg-support-red-10 text-support-red" },
  { text: "text-support-yellow", chip: "bg-support-yellow-10 text-support-yellow" },
];

export function buildVarColors(variables: { key: string }[]) {
  const text: Record<string, string> = {};
  const chip: Record<string, string> = {};
  variables.forEach((v, i) => {
    const key = stripCode(v.key);
    const c = VAR_PALETTE[i % VAR_PALETTE.length];
    text[key] = c.text;
    chip[key] = c.chip;
  });
  return { text, chip };
}
