import type { LucideIcon } from "lucide-react";
import { BotIcon, CircleDotIcon, FolderInputIcon, PaletteIcon } from "lucide-react";

export type SettingsSection = "appearance" | "agent" | "recording" | "data";

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
];

export const SETTINGS_SECTION_LABELS: Record<SettingsSection, string> = {
  appearance: "Appearance",
  agent: "Agent",
  recording: "Recording",
  data: "Data",
};

export function parseSettingsSection(value: unknown): SettingsSection {
  if (value === "agent" || value === "recording" || value === "data") return value;
  return "appearance";
}
