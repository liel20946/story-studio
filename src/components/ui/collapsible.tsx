import * as React from "react";
import * as Collapsible from "@radix-ui/react-collapsible";
import { ChevronRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function CollapsibleRoot({
  className,
  ...props
}: React.ComponentProps<typeof Collapsible.Root>) {
  return <Collapsible.Root className={cn(className)} {...props} />;
}

export function CollapsibleTrigger({
  className,
  variant,
  children,
  ...props
}: React.ComponentProps<typeof Collapsible.Trigger> & { variant?: "section" }) {
  return (
    <Collapsible.Trigger
      className={cn(
        "flex items-center outline-none",
        variant === "section" &&
          "pt-3 pb-0.5 text-mini font-medium text-tertiary tracking-normal",
        className,
      )}
      {...props}
    >
      {children}
    </Collapsible.Trigger>
  );
}

export function CollapsibleContent({
  className,
  ...props
}: React.ComponentProps<typeof Collapsible.Content>) {
  return <Collapsible.Content className={cn(className)} {...props} />;
}

export function CollapsibleChevron({ className }: { className?: string }) {
  return (
    <ChevronRightIcon
      className={cn(
        "size-4 text-tertiary transition-transform [[data-state=open]_&]:rotate-90",
        className,
      )}
    />
  );
}
