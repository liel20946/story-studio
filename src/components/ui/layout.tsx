import * as React from "react";
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";
import { cn } from "@/lib/utils";

export function SplitView({
  sidebar,
  children,
  className,
}: {
  sidebar: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex h-full min-h-0", className)}>
      <aside className="w-[15.5rem] max-w-[min(15.5rem,40vw)] shrink-0 border-r border-separator bg-surface-sidebar min-h-0 flex flex-col">
        {sidebar}
      </aside>
      <main className="main-pane flex-1 min-w-0 min-h-0 flex flex-col">{children}</main>
    </div>
  );
}

export function Sidebar({
  className,
  toolbar,
  footer,
  children,
}: {
  className?: string;
  toolbar?: React.ReactNode;
  footer?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("flex h-full flex-col bg-surface-sidebar", className)}>
      {toolbar}
      <div className="flex-1 min-h-0 overflow-hidden">{children}</div>
      {footer}
    </div>
  );
}

export function SidebarFooter({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={cn("mt-auto", className)}>{children}</div>;
}

export function SidebarList({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <ul className={cn("flex flex-col gap-0.5 px-1.5 py-1", className)}>{children}</ul>;
}

export function SidebarListGroupTitle({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "text-mini text-tertiary mb-0.5 ml-1.5 tracking-normal",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function SidebarListItem({
  selected,
  onClick,
  className,
  children,
}: {
  selected?: boolean;
  onClick?: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "group/row grid w-full grid-cols-[minmax(0,1fr)_auto_2.75rem] items-center gap-x-1.5 rounded-control px-2 py-1 text-left text-[12px] leading-4 text-primary transition-colors duration-100",
          selected && "sidebar-item-selected",
          !selected && "hover:bg-surface-hover",
          className,
        )}
      >
        {children}
      </button>
    </li>
  );
}

export function SidebarListItemContent({ children }: { children: React.ReactNode }) {
  return <span className="col-start-1 flex min-w-0 items-center gap-2">{children}</span>;
}

export function SidebarListItemTitle({ children }: { children: React.ReactNode }) {
  return <span className="truncate text-[12px] leading-4 text-primary">{children}</span>;
}

export function Toolbar({
  className,
  children,
  titlebar = false,
  surface = "sidebar",
  seamless = false,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  titlebar?: boolean;
  surface?: "sidebar" | "main";
  /** Omit the bottom border for a flush Codex-style header. */
  seamless?: boolean;
}) {
  return (
    <div
      data-toolbar
      className={cn(
        "drag-region",
        !seamless && "border-b border-separator",
        surface === "sidebar" ? "bg-surface-sidebar" : "bg-[var(--bg)]",
        titlebar && "titlebar-toolbar",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function ToolbarRow({
  className,
  children,
  inset,
  centerTitle,
}: {
  className?: string;
  children: React.ReactNode;
  inset?: "sidebar" | "main";
  centerTitle?: boolean;
}) {
  if (inset === "main" && centerTitle) {
    const childArray = React.Children.toArray(children);
    const content = childArray.find(
      (c) => React.isValidElement(c) && (c.type === ToolbarContent || c.type === ToolbarTitle),
    );
    const actions = childArray.find(
      (c) => React.isValidElement(c) && c.type === ToolbarActions,
    );
    const titleNode = React.isValidElement(content)
      ? content.props.children
      : content;

    return (
      <div
        className={cn(
          "relative flex h-11 min-h-11 items-center gap-1 px-2",
          className,
        )}
      >
        <div className="pointer-events-none absolute inset-x-0 flex h-full items-center justify-center px-28">
          {titleNode}
        </div>
        {actions ? (
          <div className="relative z-10 ml-auto flex items-center">{actions}</div>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex h-11 min-h-11 items-center gap-1 px-2",
        inset === "sidebar" && "sidebar-toolbar-actions",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ToolbarContent({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={cn("flex flex-1 items-center pl-1.5", className)}>{children}</div>;
}

export function ToolbarTitle({ children }: { children: React.ReactNode }) {
  return (
    <h1 className="truncate max-w-[min(100%,32rem)] text-regular font-medium text-primary">
      {children}
    </h1>
  );
}

export function ToolbarActions({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={cn("flex items-center gap-1 pr-2", className)}>{children}</div>;
}

export function ScrollArea({
  title,
  toolbar,
  actions,
  subtitle,
  autoScrollToBottom,
  autoScrollDeps,
  className,
  children,
}: {
  title?: string;
  toolbar?: React.ReactNode;
  actions?: React.ReactNode;
  subtitle?: React.ReactNode;
  autoScrollToBottom?: boolean;
  autoScrollDeps?: unknown[];
  className?: string;
  children: React.ReactNode;
}) {
  const bottomRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (autoScrollToBottom) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, autoScrollDeps ?? (autoScrollToBottom ? [children] : []));

  const header =
    toolbar ??
    (title || actions || subtitle ? (
      <Toolbar titlebar surface="main" seamless>
        <ToolbarRow inset="main" centerTitle>
          <ToolbarContent>
            {title ? <ToolbarTitle>{title}</ToolbarTitle> : null}
            {subtitle}
          </ToolbarContent>
          {actions ? <ToolbarActions>{actions}</ToolbarActions> : null}
        </ToolbarRow>
      </Toolbar>
    ) : null);

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      {header}
      <ScrollAreaPrimitive.Root className="flex-1 min-h-0">
        <ScrollAreaPrimitive.Viewport className="h-full w-full">
          <div className="min-h-full">
            {children}
            {autoScrollToBottom ? <div ref={bottomRef} /> : null}
          </div>
        </ScrollAreaPrimitive.Viewport>
        <ScrollAreaPrimitive.Scrollbar orientation="vertical" className="w-2 p-0.5">
          <ScrollAreaPrimitive.Thumb className="rounded-full bg-control" />
        </ScrollAreaPrimitive.Scrollbar>
      </ScrollAreaPrimitive.Root>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  actions,
  placement,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  placement?: string;
}) {
  return (
    <div
      className={cn(
        "empty-state",
        placement === "center" && "h-full min-h-[320px]",
      )}
    >
      <p className="empty-state-title">{title}</p>
      {description ? <p className="empty-state-desc">{description}</p> : null}
      {actions ? <div className="mt-3">{actions}</div> : null}
    </div>
  );
}

export function Status({
  variant,
  children,
}: {
  variant: "error";
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "rounded-pill px-2 py-1 text-small",
        variant === "error" && "bg-support-red-10 text-support-red",
      )}
    >
      {children}
    </span>
  );
}
