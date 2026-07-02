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
        "relative box-border h-4 w-4 shrink-0 rounded-full border-2 border-separator bg-transparent p-0 outline-none",
        "data-[state=checked]:border-accent",
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator className="absolute top-1/2 left-1/2 block h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent" />
    </RadioGroupPrimitive.Item>
  );
}
