export interface RecordingFailure {
  title: string;
  message: string;
  detail?: string;
}

function rawErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function isTechnicalLine(line: string): boolean {
  return (
    line.includes("Command failed:") ||
    line.includes("python3 ") ||
    line.includes("/Users/") ||
    line.includes("/Library/") ||
    line.includes("Contents/Resources/") ||
    line.includes("node_modules/")
  );
}

function lastMeaningfulLine(raw: string): string {
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (!isTechnicalLine(lines[i]!)) return lines[i]!;
  }
  return lines[lines.length - 1] ?? raw;
}

export function formatRecordingFailure(
  stage: "conversion" | "recording" | "start",
  err: unknown,
): RecordingFailure {
  const raw = rawErrorMessage(err).replace(/^Conversion failed:\s*/i, "").trim();
  const detail = raw.length > 0 ? raw : undefined;

  if (raw.includes("Codex conversion timed out")) {
    return {
      title: "Conversion timed out",
      message:
        "Codex took too long to convert the recording. Quit and restart Story Studio, verify Codex CLI works, then try again.",
      detail,
    };
  }

  if (raw.includes("Codex did not produce story content")) {
    return {
      title: "Conversion failed",
      message:
        "Codex didn't return a story. Try recording again with more actions, or check that Codex CLI is working.",
      detail,
    };
  }

  if (raw.includes("Codex returned invalid YAML")) {
    return {
      title: "Conversion failed",
      message: "Codex returned a story that couldn't be parsed. Try recording again.",
      detail,
    };
  }

  if (raw.includes("No supported Playwright actions found")) {
    return {
      title: "Nothing to convert",
      message:
        "The recording didn't capture any supported actions. Try again with clicks, typing, and navigation.",
      detail,
    };
  }

  if (raw.includes("already contains story ids") || raw.includes("already exists")) {
    return {
      title: "Could not save story",
      message:
        "This story already exists in your library. Use Record again from the story page to overwrite it.",
      detail,
    };
  }

  if (/Story must include at least one (Verify step|assertion)/i.test(raw)) {
    return {
      title: "Invalid story",
      message: "The recording is missing verification steps. Try recording again.",
      detail,
    };
  }

  if (raw.includes("has invalid position @")) {
    return {
      title: "Conversion failed",
      message:
        "An assertion was tagged with an @N position past the end of the workflow (common off-by-one). Try recording again.",
      detail,
    };
  }

  if (raw.includes("Recorded script is empty")) {
    return {
      title: "Recording empty",
      message:
        "No actions were captured. Perform steps in the browser, then click Save Recording.",
    };
  }

  if (raw.includes("ENOENT") || raw.includes("No such file or directory")) {
    return {
      title: "Conversion failed",
      message: "A required file was missing during conversion. Try recording again.",
      detail,
    };
  }

  const cleaned = lastMeaningfulLine(raw).replace(/^Error:\s*/i, "");
  const looksTechnical =
    cleaned.length > 180 || isTechnicalLine(cleaned) || /^Command failed:/i.test(raw);

  if (stage === "conversion" || raw.toLowerCase().includes("conversion")) {
    return {
      title: "Conversion failed",
      message: looksTechnical
        ? "The recording couldn't be converted into a story draft. Try recording again."
        : cleaned,
      detail: looksTechnical ? detail : undefined,
    };
  }

  return {
    title: "Recording failed",
    message: looksTechnical
      ? "Something went wrong while recording. Try again."
      : cleaned,
    detail: looksTechnical ? detail : undefined,
  };
}
