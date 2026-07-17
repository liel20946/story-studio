/** Closed vocabulary for generate-flow activity shimmer text. */
export const GENERATE_STATUS = {
  PLANNING: "Planning next moves",
  THINKING: "Thinking",
  BROWSING: "Browsing the site",
  INTERACTING: "Interacting with the page",
  /** Tab recording conversion — observing the user's Chrome tab via MCP. */
  OBSERVING_CHROME: "Observing your Chrome tab",
  RECORDING_STEPS: "Recording steps",
  DRAFTING_STORY: "Drafting story",
  WRITING_YAML: "Writing story YAML",
  REVIEWING_DRAFT: "Reviewing your draft",
  READING_DRAFT: "Reading story draft",
  UPDATING_DRAFT: "Updating story draft",
  REVIEWING_CHANGES: "Reviewing changes",
  FINISHING: "Finishing up",
} as const;

export type GenerateStatus = (typeof GENERATE_STATUS)[keyof typeof GENERATE_STATUS];

function mcpToolToStatus(toolName: string, exploring: boolean): GenerateStatus {
  const bare = toolName.replace(/^playwright__browser[-_]?|^browser[-_]?/i, "").toLowerCase();

  if (bare.includes("evaluate") || bare.includes("run_code")) {
    return GENERATE_STATUS.THINKING;
  }
  if (
    bare.includes("navigate") ||
    bare.includes("snapshot") ||
    bare.includes("screenshot") ||
    bare.includes("wait") ||
    bare.includes("network") ||
    bare.includes("tabs")
  ) {
    return exploring ? GENERATE_STATUS.BROWSING : GENERATE_STATUS.REVIEWING_CHANGES;
  }
  if (
    bare.includes("click") ||
    bare.includes("type") ||
    bare.includes("fill") ||
    bare.includes("press") ||
    bare.includes("select") ||
    bare.includes("drag") ||
    bare.includes("hover")
  ) {
    return exploring ? GENERATE_STATUS.INTERACTING : GENERATE_STATUS.REVIEWING_CHANGES;
  }
  return exploring ? GENERATE_STATUS.OBSERVING_CHROME : GENERATE_STATUS.REVIEWING_CHANGES;
}

function commandToStatus(command: string, exploring: boolean): GenerateStatus {
  if (/draft\.story\.yaml|\.story\.yaml/i.test(command)) {
    if (exploring) return GENERATE_STATUS.DRAFTING_STORY;
    if (/\b(cat|head|less|grep|read)\b/i.test(command)) {
      return GENERATE_STATUS.READING_DRAFT;
    }
    return GENERATE_STATUS.UPDATING_DRAFT;
  }
  return exploring ? GENERATE_STATUS.OBSERVING_CHROME : GENERATE_STATUS.REVIEWING_CHANGES;
}

export function progressFromCodexEvent(
  parsed: Record<string, unknown>,
  exploring: boolean,
): string | null {
  const type = parsed["type"] as string | undefined;

  if (type === "turn.started") {
    return exploring ? GENERATE_STATUS.PLANNING : GENERATE_STATUS.REVIEWING_DRAFT;
  }

  if (type === "turn.completed") {
    return exploring ? GENERATE_STATUS.WRITING_YAML : GENERATE_STATUS.FINISHING;
  }

  if (type !== "item.started") return null;

  const item = parsed["item"] as Record<string, unknown> | undefined;
  if (!item) return null;

  const itemType = item["type"] as string | undefined;
  if (itemType === "mcp_tool_call") {
    const server = (item["server"] as string | undefined) ?? "";
    const tool = (item["tool"] as string | undefined) ?? "";
    return mcpToolToStatus(`${server}__${tool}`, exploring);
  }
  if (itemType === "reasoning") {
    return exploring ? GENERATE_STATUS.THINKING : GENERATE_STATUS.REVIEWING_CHANGES;
  }
  if (itemType === "command_execution") {
    const command =
      (item["command"] as string | undefined) ??
      (item["arguments"] as Record<string, unknown> | undefined)?.["command"];
    if (typeof command === "string" && command.trim()) {
      return commandToStatus(command.trim(), exploring);
    }
    return exploring ? GENERATE_STATUS.OBSERVING_CHROME : GENERATE_STATUS.REVIEWING_CHANGES;
  }

  return null;
}
