import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface AppPageProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}

export function AppPage({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
}: AppPageProps) {
  return (
    <div className={cn("h-full overflow-auto", className)}>
      <div className="mx-auto w-full max-w-5xl px-8 py-8">
        <div className={cn("space-y-8", bodyClassName)}>
          <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                {title}
              </h1>
              {description && (
                <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
                  {description}
                </p>
              )}
            </div>
            {actions && <div className="flex items-center gap-2">{actions}</div>}
          </header>
          {children}
        </div>
      </div>
    </div>
  );
}

interface AppPanelProps {
  children: ReactNode;
  className?: string;
}

export function AppPanel({ children, className }: AppPanelProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card p-6",
        className,
      )}
    >
      {children}
    </div>
  );
}

interface AppSectionHeadingProps {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function AppSectionHeading({
  title,
  description,
  action,
  className,
}: AppSectionHeadingProps) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4",
        className,
      )}
    >
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {description && (
          <p className="text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

interface AppChipProps {
  children: ReactNode;
  className?: string;
}

export function AppChip({ children, className }: AppChipProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}
