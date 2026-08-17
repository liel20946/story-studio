import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { FileIcon, FolderIcon, Loader2Icon, PlusIcon } from "lucide-react";

export function PathAttachMenu({
  disabled,
  busy,
  onAttach,
  ariaLabel = "Attach file or folder",
}: {
  disabled?: boolean;
  busy?: boolean;
  onAttach: (mode: "files" | "folder") => void;
  ariaLabel?: string;
}) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="generate-composer-attach-btn"
          disabled={disabled || busy}
          aria-label={ariaLabel}
        >
          {busy ? (
            <Loader2Icon className="generate-composer-attach-btn-icon animate-spin" />
          ) : (
            <PlusIcon className="generate-composer-attach-btn-icon" absoluteStrokeWidth />
          )}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="generate-composer-attach-menu"
          side="bottom"
          align="end"
          sideOffset={6}
        >
          <DropdownMenu.Item
            className="generate-composer-attach-menu-item"
            onSelect={() => onAttach("files")}
          >
            <FileIcon className="generate-composer-attach-menu-item-icon" />
            Attach file
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className="generate-composer-attach-menu-item"
            onSelect={() => onAttach("folder")}
          >
            <FolderIcon className="generate-composer-attach-menu-item-icon" />
            Attach folder
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
