import { toast } from "@/components/ui";

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error);
}

/** Builds a copy-friendly error string for toast.error. */
export function formatAppError(
  ...parts: Array<string | null | undefined | false>
): string {
  const normalized: string[] = [];

  for (const part of parts) {
    if (!part || typeof part !== "string") continue;
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (normalized[normalized.length - 1] === trimmed) continue;
    normalized.push(trimmed);
  }

  return normalized.join("\n");
}

export function reportAppError(
  ...parts: Array<string | null | undefined | false>
): void {
  toast.error(formatAppError(...parts));
}

export function reportAppErrorFromUnknown(
  context: string,
  error: unknown,
  detail?: string | null,
): void {
  reportAppError(context, errorMessage(error), detail);
}
