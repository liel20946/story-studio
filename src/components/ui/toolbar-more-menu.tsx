import * as React from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { EllipsisIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

export type ToolbarMoreItem = {
  id: string;
  label: string;
  icon?: React.ReactNode;
  disabled?: boolean;
  onSelect: () => void;
};

/**
 * Compact overflow menu for secondary titlebar actions.
 * Place to the left of the primary toolbar CTA.
 */
export function ToolbarMoreMenu({
  items,
  label = "More",
}: {
  items: ToolbarMoreItem[];
  label?: string;
}) {
  const visible = items.filter(Boolean);
  if (visible.length === 0) return null;

  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <Button
          variant="glass"
          size="titlebar"
          radius="full"
          aria-label="More actions"
        >
          <EllipsisIcon className="size-4" />
          {label}
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="toolbar-more-menu z-50 min-w-[11rem] rounded-control border border-separator bg-popover p-1 shadow-lg"
          align="end"
          sideOffset={6}
        >
          {visible.map((item) => (
            <DropdownMenu.Item
              key={item.id}
              disabled={item.disabled}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-control px-2 py-1.5 text-small text-primary outline-none",
                "data-[highlighted]:bg-surface-hover",
                "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
              )}
              onSelect={() => {
                if (item.disabled) return;
                item.onSelect();
              }}
            >
              {item.icon ? (
                <span className="toolbar-more-menu-icon flex size-3.5 shrink-0 items-center justify-center text-secondary [&_svg]:size-3.5">
                  {item.icon}
                </span>
              ) : null}
              {item.label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
