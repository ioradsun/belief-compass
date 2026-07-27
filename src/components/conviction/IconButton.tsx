import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** IconButton — icon-only control. `label` is required and becomes the a11y name. */
export function IconButton({
  label,
  children,
  className,
  ...rest
}: { label: string; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "grid h-8 w-8 shrink-0 place-items-center rounded-sm border border-border",
        "bg-surface text-text-secondary",
        "transition-colors duration-200 hover:border-border-strong hover:text-text",
        "focus-visible:ring-1 focus-visible:ring-border-strong focus-visible:outline-none",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
