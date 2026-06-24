import * as React from "react";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { cn } from "@/lib/utils";

export function RadioGroup({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Root> & {
  orientation?: "vertical" | "horizontal";
}) {
  return (
    <RadioGroupPrimitive.Root
      className={cn(
        "flex gap-3",
        orientation === "horizontal" ? "flex-row" : "flex-col",
        className,
      )}
      {...props}
    />
  );
}

export function RadioGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      className={cn(
        "size-4 rounded-full border border-separator bg-control outline-none data-[state=checked]:border-accent data-[state=checked]:bg-accent",
        className,
      )}
      {...props}
    />
  );
}
