import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * EmptyState — says plainly what is absent. No encouragement language,
 * no counts framed as progress, no reward copy.
 */
export function EmptyState({
  title,
  detail,
  icon,
  className,
}: {
  title: string;
  detail?: string;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border",
        "bg-surface/40 px-4 py-8 text-center",
        className,
      )}
    >
      {icon ? <span className="text-text-muted">{icon}</span> : null}
      <p className="text-sm text-text-secondary">{title}</p>
      {detail ? <p className="max-w-[36ch] text-fine text-text-secondary">{detail}</p> : null}
    </div>
  );
}
