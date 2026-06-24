import type { LucideIcon } from "lucide-react";
import { CircleDotIcon, FolderInputIcon, PaletteIcon } from "lucide-react";

export type SettingsSection = "appearance" | "recording" | "data";

export type SettingsNavItem = {
  id: SettingsSection;
  label: string;
  icon: LucideIcon;
};

export const SETTINGS_NAV: SettingsNavItem[] = [
  { id: "appearance", label: "Appearance", icon: PaletteIcon },
  { id: "recording", label: "Recording", icon: CircleDotIcon },
  { id: "data", label: "Data", icon: FolderInputIcon },
];

export const SETTINGS_SECTION_LABELS: Record<SettingsSection, string> = {
  appearance: "Appearance",
  recording: "Recording",
  data: "Data",
};

export function parseSettingsSection(value: unknown): SettingsSection {
  if (value === "recording" || value === "data") return value;
  return "appearance";
}
