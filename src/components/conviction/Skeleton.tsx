import { cn } from "@/lib/utils";

/**
 * Skeleton — occupies the FINAL dimensions of the thing it stands in for,
 * so nothing shifts when data lands.
 */
export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <span
      aria-hidden="true"
      style={style}
      className={cn("block animate-pulse rounded-sm bg-surface-raised", className)}
    />
  );
}

export function SideSkeleton() {
  return (
    <div className="rounded-md border border-border bg-surface px-4 py-4">
      <Skeleton className="h-[10px] w-12" />
      <Skeleton className="mt-3 h-[22px] w-20" />
      <Skeleton className="mt-2 h-[20px] w-16" />
      <Skeleton className="mt-4 h-[13px] w-28" />
      <div className="mt-4 flex flex-col gap-2">
        <Skeleton className="h-7 w-full" />
        <Skeleton className="h-7 w-full" />
        <Skeleton className="h-7 w-full" />
      </div>
    </div>
  );
}

export function RowSkeleton() {
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-3">
      <Skeleton className="h-[13px] w-full" />
      <Skeleton className="mt-2 h-[11px] w-24" />
    </div>
  );
}
