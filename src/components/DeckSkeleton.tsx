/**
 * First-paint skeleton for the center deck. It mirrors MarketDeck's real shape —
 * identity → pulse → YES/NO battlefield → intelligence → decision dock — with a
 * soft shimmer and faint YES/NO tints, so the loading state reads as a live market
 * materializing, not a spinner or a "nothing here" card. SSR-rendered, so it's in
 * the very first HTML the browser paints.
 */
function Bar({ className = "", tint }: { className?: string; tint?: string }) {
  return (
    <div
      className={`animate-pulse rounded-[6px] motion-reduce:animate-none ${className}`}
      style={{ background: tint ?? "color-mix(in oklab, var(--text-muted) 18%, transparent)" }}
    />
  );
}

function SideSkeleton({ side }: { side: "YES" | "NO" }) {
  const col = side === "YES" ? "var(--yes)" : "var(--no)";
  return (
    <div
      className="flex flex-col gap-3 rounded-[14px] p-3"
      style={{
        background: `color-mix(in oklab, ${col} 6%, var(--surface))`,
      }}
    >
      <Bar className="h-2.5 w-8" tint={`color-mix(in oklab, ${col} 55%, transparent)`} />
      <Bar className="h-6 w-20" />
      <Bar className="h-2.5 w-24" />
    </div>
  );
}

export function DeckSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3" aria-hidden aria-busy="true">
      {/* Identity */}
      <div className="shrink-0 space-y-2">
        <Bar className="h-2.5 w-16" />
        <Bar className="h-7 w-[72%]" />
      </div>

      {/* Pulse */}
      <div
        className="flex items-center gap-2 rounded-[12px] bg-[var(--surface)] px-3 py-2.5"
      >
        <div className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-[var(--top-voice,#d7ae58)] motion-reduce:animate-none" />
        <Bar className="h-3 w-24" />
        <Bar className="h-3 w-40 max-w-[40%]" />
      </div>

      {/* Battlefield */}
      <div className="grid grid-cols-2 gap-2">
        <SideSkeleton side="YES" />
        <SideSkeleton side="NO" />
      </div>

      {/* Intelligence box */}
      <div className="space-y-2 rounded-[14px] bg-[var(--surface)] p-3">
        <Bar className="h-3 w-28" />
        <Bar className="h-4 w-[80%]" />
        <Bar className="h-4 w-[60%]" />
      </div>

      {/* Decision dock */}
      <div
        className="mt-auto flex items-center gap-2 rounded-[16px] bg-[var(--surface)] p-3"
      >
        <Bar className="h-[52px] w-[86px]" />
        <div className="flex flex-1 gap-2">
          <Bar className="h-[52px] flex-1" tint="color-mix(in oklab, var(--no) 14%, transparent)" />
          <Bar className="h-[52px] flex-1" />
          <Bar
            className="h-[52px] flex-1"
            tint="color-mix(in oklab, var(--yes) 14%, transparent)"
          />
        </div>
      </div>
    </div>
  );
}
