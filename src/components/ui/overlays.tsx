import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { KeyboardShortcut, type ShortcutKey } from "./keyboard-shortcut";

export function Dialog({
  open,
  onOpenChange,
  title,
  confirmLabel,
  confirmDisabled,
  onConfirm,
  children,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title?: string;
  confirmLabel?: string;
  confirmDisabled?: boolean;
  onConfirm?: () => void;
  children?: React.ReactNode;
}) {
  if (title && onConfirm) {
    return (
      <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
        <DialogContent size="small">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <DialogBody>{children}</DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="transparent">Cancel</Button>
            </DialogClose>
            <Button variant="accent" disabled={confirmDisabled} onClick={onConfirm}>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </DialogPrimitive.Root>
    );
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {children}
    </DialogPrimitive.Root>
  );
}

export function DialogContent({
  className,
  size = "medium",
  children,
  onEscapeKeyDown,
}: {
  className?: string;
  size?: "small" | "medium" | "large";
  children: React.ReactNode;
  onEscapeKeyDown?: (e: KeyboardEvent) => void;
}) {
  const sizeClass =
    size === "small" ? "max-w-sm" : size === "large" ? "max-w-2xl" : "max-w-md";
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="dialog-overlay fixed inset-0 z-50" />
      <DialogPrimitive.Content
        className={cn(
          "dialog-surface fixed left-1/2 top-1/2 z-50 w-full -translate-x-1/2 -translate-y-1/2 rounded-card border border-separator bg-popover p-0",
          sizeClass,
          className,
        )}
        onEscapeKeyDown={onEscapeKeyDown}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-3">{children}</div>;
}

export function DialogTitle({ children }: { children: React.ReactNode }) {
  return (
    <DialogPrimitive.Title className="font-display text-regular tracking-tight">
      {children}
    </DialogPrimitive.Title>
  );
}

export function DialogDescription({ children }: { children: React.ReactNode }) {
  return (
    <DialogPrimitive.Description className="text-small text-secondary mt-1">
      {children}
    </DialogPrimitive.Description>
  );
}

export function DialogBody({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-4">{children}</div>;
}

export function DialogFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-end gap-2 px-4 py-3">{children}</div>
  );
}

export const DialogClose = DialogPrimitive.Close;

export function AlertDialog({
  trigger,
  title,
  description,
  confirmLabel = "Confirm",
  confirmVariant = "accent",
  onConfirm,
}: {
  trigger: React.ReactNode;
  title: string;
  description: string;
  confirmLabel?: string;
  confirmVariant?: "accent" | "destructive";
  onConfirm: () => void;
}) {
  return (
    <AlertDialogPrimitive.Root>
      <AlertDialogPrimitive.Trigger asChild>{trigger}</AlertDialogPrimitive.Trigger>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className="dialog-overlay fixed inset-0 z-50" />
        <AlertDialogPrimitive.Content className="dialog-surface fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-card border border-separator bg-popover p-4">
          <AlertDialogPrimitive.Title className="font-display text-regular tracking-tight">
            {title}
          </AlertDialogPrimitive.Title>
          <AlertDialogPrimitive.Description className="text-small text-secondary mt-2">
            {description}
          </AlertDialogPrimitive.Description>
          <div className="flex justify-end gap-2 mt-4">
            <AlertDialogPrimitive.Cancel asChild>
              <Button variant="transparent">Cancel</Button>
            </AlertDialogPrimitive.Cancel>
            <AlertDialogPrimitive.Action asChild>
              <Button
                variant="accent"
                className={confirmVariant === "destructive" ? "bg-support-red-10 text-support-red" : undefined}
                onClick={onConfirm}
              >
                {confirmLabel}
              </Button>
            </AlertDialogPrimitive.Action>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}

export const ContextMenu = ContextMenuPrimitive.Root;
export const ContextMenuTrigger = ContextMenuPrimitive.Trigger;
export function ContextMenuSub({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <ContextMenuPrimitive.Sub>
      <ContextMenuPrimitive.SubTrigger className="flex cursor-pointer items-center rounded-control px-2 py-1.5 text-small text-primary outline-none data-[highlighted]:bg-surface-hover">
        {label}
      </ContextMenuPrimitive.SubTrigger>
      <ContextMenuPrimitive.SubContent className="z-50 min-w-[160px] rounded-control border border-separator bg-popover p-1 shadow-lg">
        {children}
      </ContextMenuPrimitive.SubContent>
    </ContextMenuPrimitive.Sub>
  );
}
export const ContextMenuSeparator = ContextMenuPrimitive.Separator;

export function ContextMenuContent({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        className={cn(
          "z-50 min-w-[160px] rounded-control border border-separator bg-popover p-1 shadow-lg",
          className,
        )}
      >
        {children}
      </ContextMenuPrimitive.Content>
    </ContextMenuPrimitive.Portal>
  );
}

export function ContextMenuItem({
  children,
  onSelect,
  icon,
  color,
}: {
  children: React.ReactNode;
  onSelect?: (event: Event) => void;
  icon?: string;
  color?: string;
}) {
  return (
    <ContextMenuPrimitive.Item
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-control px-2 py-1.5 text-small text-primary outline-none data-[highlighted]:bg-surface-hover",
        color === "red" && "text-support-red",
      )}
      onSelect={onSelect}
    >
      {icon ? <span className="text-tertiary">{icon}</span> : null}
      {children}
    </ContextMenuPrimitive.Item>
  );
}

export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return <TooltipPrimitive.Provider delayDuration={300}>{children}</TooltipPrimitive.Provider>;
}

export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export function TooltipContent({
  children,
  shortcut,
}: {
  children: React.ReactNode;
  shortcut?: ShortcutKey[];
}) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        className="z-[200] rounded-control border border-separator bg-popover px-2 py-1 text-small text-primary shadow-lg"
        sideOffset={6}
        side="bottom"
      >
        <span className="flex items-center gap-2">
          {children}
          {shortcut?.length ? <KeyboardShortcut keys={shortcut} /> : null}
        </span>
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

export function ErrorBoundaryView({ error }: { error: Error }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8">
      <p className="text-strong text-support-red">Something went wrong</p>
      <p className="text-small text-secondary">{error.message}</p>
    </div>
  );
}
