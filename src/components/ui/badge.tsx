import { cn } from "@/lib/utils";

export function Badge({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm border border-border bg-surface-2 px-2 py-0.5 text-xs font-medium tracking-wide text-fg-muted uppercase",
        className,
      )}
      {...props}
    />
  );
}
