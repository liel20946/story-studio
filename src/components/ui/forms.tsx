import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "flex h-9 w-full rounded-control border border-field bg-control px-3 text-regular text-primary outline-none placeholder:text-tertiary focus:border-field disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "flex min-h-[80px] w-full rounded-control border border-field bg-control px-3 py-2 text-regular text-primary outline-none placeholder:text-tertiary focus:border-field disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export function Label({
  className,
  children,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("inline-flex items-center gap-2 text-regular text-primary", className)}
      {...props}
    >
      {children}
    </label>
  );
}

export function FieldSet({
  title,
  children,
  className,
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <fieldset className={cn("m-0 flex min-w-0 flex-col gap-2 border-0 p-0", className)}>
      {title ? <legend className="settings-group-title !px-0 !pb-1">{title}</legend> : null}
      <div className="settings-group">
        <div className="settings-group-body">{children}</div>
      </div>
    </fieldset>
  );
}

export function FieldGroup({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex flex-col gap-4", className)}>{children}</div>;
}

export function Field({
  label,
  description,
  orientation = "vertical",
  children,
  className,
}: {
  label?: string;
  description?: string;
  orientation?: "vertical" | "horizontal";
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex gap-3",
        orientation === "horizontal" ? "flex-row items-center justify-between" : "flex-col",
        className,
      )}
    >
      {(label || description) && (
        <div className="flex flex-col gap-0.5">
          {label ? <span className="text-strong">{label}</span> : null}
          {description ? <span className="text-small text-tertiary">{description}</span> : null}
        </div>
      )}
      {children}
    </div>
  );
}
