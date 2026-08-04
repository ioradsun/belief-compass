/**
 * First-paint skeleton for the centre deck.
 *
 * ITS ONLY JOB IS TO OCCUPY THE DECK'S EXACT GEOMETRY. It is not decoration and
 * not a spinner: it is the same boxes, at the same sizes, in the same places, so
 * that when the real market arrives nothing moves. The previous version invented
 * its own shape — a pulse strip, a two-column YES/NO battlefield, an
 * intelligence card — none of which the deck has rendered for some time, so
 * every first paint ended with the whole column rearranging itself.
 *
 * The structure below mirrors MarketDeck, class for class:
 *
 *   flex h-full min-h-0 flex-col gap-3
 *     identity  shrink-0   meta row (mb-1, min-h-[26px])
 *                          title box (min-h-[2.4em], clamped font, leading-1.2)
 *                          byline row (min-h-[32px])
 *     body      flex-1     hint row (min-h-[17px]) + the Total Market
 *                          instrument: two metric rows + the docked read
 *     dock      shrink-0   one 16px card holding three 52px controls
 *
 * If MarketDeck's geometry changes this must change with it — that is the whole
 * point of it, and scripts/measure-transitions.mjs is what catches the drift.
 *
 * SSR-rendered, so it is in the very first HTML the browser paints.
 */
function Bar({ className = "", tint }: { className?: string; tint?: string }) {
  return (
    <div
      className={`animate-pulse rounded-[6px] motion-reduce:animate-none ${className}`}
      style={{ background: tint ?? "color-mix(in oklab, var(--text-muted) 18%, transparent)" }}
    />
  );
}

/** One row of the Total Market instrument — the same padding and type sizes. */
function MetricRow({ width }: { width: string }) {
  return (
    <div className="px-4 py-3 sm:px-5">
      <div className="flex items-baseline justify-between gap-4">
        {/* The headline figure (26px, 30px from sm) and its percentage. */}
        <Bar className={`h-[30px] ${width}`} />
        <Bar className="h-[26px] w-[64px]" />
      </div>
      {/* The 10px uppercase label, at its mt-1.5 offset. */}
      <div className="mt-1.5">
        <Bar className="h-[10px] w-[104px]" />
      </div>
      {/* The movement line beneath it. */}
      <div className="mt-1.5">
        <Bar className="h-[12px] w-[62%]" />
      </div>
    </div>
  );
}

export function DeckSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3" aria-hidden aria-busy="true">
      {/* IDENTITY — the same three reserved rows the deck pins to the top. */}
      <div className="shrink-0">
        <div className="mb-1 flex min-h-[26px] items-center gap-2">
          <Bar className="h-[11px] w-[128px]" />
        </div>
        {/* The two-line title box. `min-h-[2.4em]` on the deck's clamped font
          size is the rule; matching it here is what keeps the body from moving
          when the real question arrives. */}
        <div className="flex min-h-[2.4em] items-start gap-1.5 text-[clamp(20px,2.4vw,30px)] leading-[1.2]">
          <div className="min-w-0 flex-1 space-y-2 py-1">
            <Bar className="h-[0.62em] w-[86%]" />
            <Bar className="h-[0.62em] w-[54%]" />
          </div>
          <Bar className="h-7 w-7 shrink-0 rounded-full" />
        </div>
        <div className="min-h-[32px] pt-2">
          <Bar className="h-6 w-[168px] rounded-full" />
        </div>
      </div>

      {/* BODY — the hint row, then the ONE market instrument. */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden pr-0.5">
        <div className="min-h-[17px] shrink-0" />
        {/* The one timeframe control, at its real width and height — the deck
          puts it above the instrument, so leaving it out here would land the
          instrument ~40px too high and drop it into place on arrival. */}
        <div className="max-w-[300px] shrink-0">
          <Bar className="h-[34px] w-full rounded-[10px]" />
        </div>
        <section
          className="shrink-0 overflow-hidden rounded-[16px]"
          style={{ background: "var(--surface)", border: "1px solid var(--hairline)" }}
        >
          <MetricRow width="w-[128px]" />
          <div className="border-t border-[var(--hairline)]" aria-hidden />
          <MetricRow width="w-[152px]" />
          <div className="border-t border-[var(--hairline)]" aria-hidden />
          {/* The docked read — the market signal, the House's line, and the
            "See both sides" disclosure. Three rows, because that is what the
            real one occupies even at its shortest. */}
          <div className="space-y-3 px-4 py-[18px] sm:px-5">
            <Bar className="h-[13px] w-[58%]" />
            <Bar className="h-[13px] w-[76%]" />
            <div className="flex items-center gap-3 pt-1">
              <Bar className="h-[13px] min-w-0 flex-1" />
              <Bar className="h-[13px] w-[92px] shrink-0" />
            </div>
          </div>
        </section>
      </div>

      {/* DOCK — one card, three controls, at the deck's exact 52px height, so
        the thing the hand is aimed at is already in its final position. */}
      <div data-probe="dock" className="shrink-0 space-y-3 pb-[env(safe-area-inset-bottom)]">
        <div className="overflow-hidden rounded-[16px]" style={{ background: "var(--surface)" }}>
          <div className="flex gap-2 p-3.5">
            <Bar
              className="h-[52px] flex-1 rounded-[12px]"
              tint="color-mix(in oklab, var(--no) 14%, transparent)"
            />
            <Bar
              className="h-[52px] flex-1 rounded-[12px]"
              tint="color-mix(in oklab, var(--yes) 14%, transparent)"
            />
            <Bar className="h-[52px] flex-1 rounded-[12px]" />
          </div>
        </div>
      </div>
    </div>
  );
}
