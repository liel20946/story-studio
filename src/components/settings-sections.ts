import type { LucideIcon } from "lucide-react";
import { BotIcon, CircleDotIcon, FolderInputIcon, PaletteIcon, WrenchIcon } from "lucide-react";

export type SettingsSection = "setup" | "appearance" | "agent" | "recording" | "data";

export type SettingsNavItem = {
  id: SettingsSection;
  label: string;
  icon: LucideIcon;
};

export const SETTINGS_NAV: SettingsNavItem[] = [
  { id: "appearance", label: "Appearance", icon: PaletteIcon },
  { id: "agent", label: "Agent", icon: BotIcon },
  { id: "recording", label: "Recording", icon: CircleDotIcon },
  { id: "data", label: "Data", icon: FolderInputIcon },
  { id: "setup", label: "Setup", icon: WrenchIcon },
];

export const SETTINGS_SECTION_LABELS: Record<SettingsSection, string> = {
  setup: "Setup",
  appearance: "Appearance",
  agent: "Agent",
  recording: "Recording",
  data: "Data",
};

export function parseSettingsSection(value: unknown): SettingsSection {
  if (
    value === "setup" ||
    value === "agent" ||
    value === "recording" ||
    value === "data"
  ) {
    return value;
  }
  return "appearance";
}
