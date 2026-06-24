import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 font-medium transition-colors duration-100 outline-none disabled:pointer-events-none shrink-0",
  {
    variants: {
      variant: {
        filled:
          "bg-control text-primary hover:bg-surface-hover border border-separator disabled:bg-control disabled:text-tertiary disabled:border-separator",
        glass:
          "bg-control text-primary hover:bg-surface-hover border border-separator disabled:bg-control disabled:text-tertiary disabled:border-separator",
        transparent:
          "bg-transparent text-secondary hover:bg-surface-hover hover:text-primary disabled:text-tertiary",
        accent:
          "bg-accent hover:opacity-90 border border-transparent disabled:opacity-100",
      },
      size: {
        small: "h-7 px-2.5 text-small",
        medium: "h-8 px-3 text-small",
        toolbar: "size-8 p-0",
      },
      radius: {
        default: "rounded-control",
        full: "rounded-pill",
      },
      iconOnly: {
        true: "p-0",
        false: "",
      },
    },
    compoundVariants: [
      { size: "small", iconOnly: true, className: "size-7" },
      { size: "medium", iconOnly: true, className: "size-8" },
      { size: "toolbar", iconOnly: true, className: "size-8" },
    ],
    defaultVariants: {
      variant: "filled",
      size: "medium",
      radius: "full",
      iconOnly: false,
    },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

export function Button({
  className,
  variant,
  size,
  radius,
  iconOnly,
  asChild = false,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={cn(buttonVariants({ variant, size, radius, iconOnly }), className)}
      {...props}
    />
  );
}
