import * as React from "react";
import { cn } from "@/lib/utils";

export function ContentCard({
  title,
  action,
  className,
  children,
}: {
  title?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("content-card", className)}>
      {title ? (
        <header className="content-card-header">
          <span className="section-label !mb-0 !p-0">{title}</span>
          {action}
        </header>
      ) : null}
      <div className="content-card-body">{children}</div>
    </section>
  );
}
