import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "@/lib/utils";
import { reportAppError } from "@/lib/app-error";
import { Button } from "./button";
import { Field } from "./forms";
import { KeyboardShortcut, type ShortcutKey } from "./keyboard-shortcut";

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  fieldLabel,
  size,
  confirmLabel,
  confirmDisabled,
  onConfirm,
  children,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title?: string;
  description?: string;
  fieldLabel?: string;
  size?: "small" | "medium";
  confirmLabel?: string;
  confirmDisabled?: boolean;
  onConfirm?: () => void;
  children?: React.ReactNode;
}) {
  if (title && onConfirm) {
    const dialogSize = size ?? (description || fieldLabel ? "medium" : "small");
    return (
      <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
        <DialogContent size={dialogSize}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? (
              <DialogDescription>{description}</DialogDescription>
            ) : null}
          </DialogHeader>
          <DialogBody>
            {fieldLabel ? (
              <Field label={fieldLabel} orientation="vertical">
                {children}
              </Field>
            ) : (
              children
            )}
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="filled">Cancel</Button>
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
  const dialogCenterClass =
    "left-[calc(var(--sidebar-width,0px)+(100vw-var(--sidebar-width,0px))/2)]";
  return (
    <DialogPrimitive.Portal container={document.body}>
      <DialogPrimitive.Overlay className="dialog-overlay fixed inset-0 z-50" />
      <DialogPrimitive.Content
        className={cn(
          "dialog-surface fixed top-1/2 z-50 flex w-full -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-card border border-separator bg-popover p-4",
          dialogCenterClass,
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
  return <div className="flex flex-col gap-1">{children}</div>;
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
    <DialogPrimitive.Description className="text-small text-secondary">
      {children}
    </DialogPrimitive.Description>
  );
}

export function DialogBody({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-3">{children}</div>;
}

export function DialogFooter({ children }: { children: React.ReactNode }) {
  return <div className="flex justify-end gap-2">{children}</div>;
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
  title: React.ReactNode;
  description: string;
  confirmLabel?: string;
  confirmVariant?: "accent" | "destructive";
  onConfirm: () => void;
}) {
  return (
    <AlertDialogPrimitive.Root>
      <AlertDialogPrimitive.Trigger asChild>{trigger}</AlertDialogPrimitive.Trigger>
      <AlertDialogPrimitive.Portal container={document.body}>
        <AlertDialogPrimitive.Overlay
          className="dialog-overlay fixed inset-0 z-50"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        />
        <AlertDialogPrimitive.Content
          className={cn(
            "dialog-surface fixed top-1/2 z-50 flex w-full max-w-sm -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-card border border-separator bg-popover p-4",
            "left-[calc(var(--sidebar-width,0px)+(100vw-var(--sidebar-width,0px))/2)]",
          )}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <div className="flex flex-col gap-1">
            <AlertDialogPrimitive.Title className="font-display text-regular tracking-tight">
              {title}
            </AlertDialogPrimitive.Title>
            <AlertDialogPrimitive.Description className="text-small text-secondary">
              {description}
            </AlertDialogPrimitive.Description>
          </div>
          <div className="flex justify-end gap-2">
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
  return (
    <TooltipPrimitive.Provider delayDuration={300} disableHoverableContent>
      {children}
    </TooltipPrimitive.Provider>
  );
}

export const Tooltip = TooltipPrimitive.Root;

export const TooltipTrigger = React.forwardRef<
  React.ComponentRef<typeof TooltipPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Trigger>
>(function TooltipTrigger({ onPointerLeave, ...props }, ref) {
  return (
    <TooltipPrimitive.Trigger
      ref={ref}
      onPointerLeave={(event) => {
        onPointerLeave?.(event);
        // Electron often keeps toolbar buttons focused after hover; blur so a
        // focus-opened tooltip cannot outlive the pointer leaving the trigger.
        event.currentTarget.blur();
      }}
      {...props}
    />
  );
});

export function TooltipContent({
  children,
  shortcut,
  side = "bottom",
}: {
  children?: React.ReactNode;
  shortcut?: ShortcutKey[];
  side?: React.ComponentProps<typeof TooltipPrimitive.Content>["side"];
}) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        className="z-[200] rounded-control border border-separator bg-popover px-2 py-1 text-small text-primary shadow-lg"
        sideOffset={6}
        side={side}
      >
        {shortcut?.length ? (
          <KeyboardShortcut keys={shortcut} />
        ) : (
          children
        )}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

export function ErrorBoundaryView({ error }: { error: Error }) {
  const reportedRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    const key = `${error.message}\n${error.stack ?? ""}`;
    if (reportedRef.current === key) return;
    reportedRef.current = key;
    reportAppError("Something went wrong", error.message, error.stack);
  }, [error]);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8">
      <p className="text-strong text-support-red">Something went wrong</p>
      <p className="text-small text-secondary">{error.message}</p>
    </div>
  );
}
