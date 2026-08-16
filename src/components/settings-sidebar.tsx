import { useNavigate } from "@tanstack/react-router";
import { ChevronLeftIcon } from "lucide-react";
import { useReturnFromSettings } from "@/lib/return-from-settings";
import { useSettingsSection } from "@/lib/use-settings-section";
import { MacTitlebarRow } from "./mac-traffic-lights";
import {
  Sidebar,
  Toolbar,
  ToolbarRow,
  SidebarListGroupTitle,
  SidebarList,
  SidebarListItem,
  SidebarListItemContent,
  SidebarListItemTitle,
  SidebarRowGroup,
} from "@/components/ui";
import {
  SETTINGS_NAV,
  type SettingsSection,
} from "./settings-sections";

export function SettingsSidebar() {
  const navigate = useNavigate();
  const returnFromSettings = useReturnFromSettings();
  const activeSection = useSettingsSection();

  function handleBack() {
    returnFromSettings();
  }

  function selectSection(section: SettingsSection) {
    navigate({ to: "/settings", search: { section }, replace: true });
  }

  return (
    <Sidebar
      className="!p-0 [&>div]:rounded-none"
      toolbar={
        <Toolbar className="border-b-0 bg-surface-sidebar">
          <MacTitlebarRow />
          {/* Match app sidebar actions row (pt-3 pb-0) so "Story Studio"
              lands at the same height as the Stories section label. */}
          <ToolbarRow className="sidebar-actions-row h-auto min-h-0 px-1.5 pt-3 pb-0">
            <ul className="flex w-full flex-col">
              <SidebarListItem onClick={handleBack}>
                <SidebarListItemContent>
                  <ChevronLeftIcon
                    className="size-3.5 shrink-0 text-tertiary"
                  />
                  <SidebarListItemTitle>Back to app</SidebarListItemTitle>
                </SidebarListItemContent>
              </SidebarListItem>
            </ul>
          </ToolbarRow>
        </Toolbar>
      }
    >
      <SidebarList className="pt-0 pb-1">
        {/* pt-4 matches the stories tab panel inset above the Stories label. */}
        <div className="pt-4">
          <div className="flex w-full items-center gap-2 px-2 pt-0 pb-0.5">
            <SidebarListGroupTitle className="mb-0 ml-0">
              Story Studio
            </SidebarListGroupTitle>
          </div>
          <div className="pb-1">
            <SidebarRowGroup>
              {SETTINGS_NAV.map((item) => {
                const Icon = item.icon;
                const selected = activeSection === item.id;
                return (
                  <SidebarListItem
                    key={item.id}
                    selected={selected}
                    onClick={() => selectSection(item.id)}
                  >
                    <SidebarListItemContent>
                      <Icon
                        className="size-3.5 shrink-0 text-tertiary"
                      />
                      <SidebarListItemTitle>{item.label}</SidebarListItemTitle>
                    </SidebarListItemContent>
                  </SidebarListItem>
                );
              })}
            </SidebarRowGroup>
          </div>
        </div>
      </SidebarList>
    </Sidebar>
  );
}
