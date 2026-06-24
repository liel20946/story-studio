import { useNavigate, useSearch } from "@tanstack/react-router";
import { ChevronLeftIcon } from "lucide-react";
import { Sidebar } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  SETTINGS_NAV,
  type SettingsSection,
} from "./settings-sections";

export function SettingsSidebar() {
  const navigate = useNavigate();
  const { section: activeSection } = useSearch({ from: "/settings" });

  function handleBack() {
    navigate({ to: "/" });
  }

  function selectSection(section: SettingsSection) {
    navigate({ to: "/settings", search: { section }, replace: true });
  }

  return (
    <Sidebar className="!p-0 [&>div]:rounded-none">
      <div className="drag-region sidebar-titlebar-spacer" aria-hidden />
      <div className="px-2 pb-3 pt-1">
        <button
          type="button"
          onClick={handleBack}
          className="flex w-full items-center gap-1.5 rounded-control px-2 py-1.5 text-left text-[12px] leading-4 text-secondary transition-colors hover:bg-surface-hover hover:text-primary"
        >
          <ChevronLeftIcon className="size-3.5 shrink-0" />
          Back to app
        </button>
      </div>
      <nav className="px-1.5">
        <span className="sidebar-section-label">Story Studio</span>
        <ul className="flex flex-col gap-0.5">
          {SETTINGS_NAV.map((item) => {
            const Icon = item.icon;
            const selected = activeSection === item.id;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => selectSection(item.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left text-[12px] leading-4 transition-colors",
                    selected
                      ? "sidebar-item-selected text-primary"
                      : "text-secondary hover:bg-surface-hover hover:text-primary",
                  )}
                >
                  <Icon className="size-3.5 shrink-0 opacity-80" strokeWidth={1.75} />
                  {item.label}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </Sidebar>
  );
}
