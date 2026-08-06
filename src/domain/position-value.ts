/**
 * WHAT A POSITION IS WORTH, and how sure we are.
 *
 * `wallet_beliefs.yes_value_usd` / `no_value_usd` were added as columns and
 * NOTHING HAS EVER WRITTEN THEM. Six read sites, zero writers. Every one of them
 * did `Number(row.yes_value_usd) || 0` and carried on with a confident zero:
 *
 *   · Conviction cohorts — every holder failed the $5 dust gate, so the catch-up
 *     sweep walked all 2,760 markets and emitted nothing.
 *   · Standing facts — same gate, so the quiet-mode pool was always empty.
 *   · Evidence — every believer's value was $0, so no whale was ever detected.
 *   · The conviction dashboard — `if (worth > 0) heldCount++` never fired, so it
 *     told every reader they held nothing.
 *
 * This is the third instance of the same failure this codebase has hit:
 * `Number(null) === 0` turns "we do not know" into "it is zero", and a zero is
 * indistinguishable from a fact. So this module refuses to produce a bare
 * number — it returns the value AND where the value came from, and callers that
 * cannot honestly act on a guess are able to say so.
 *
 * FOUR SOURCES, IN ORDER:
 *
 *   1. MARKED, FRESH. A real USD valuation written by `belief-rollup` within
 *      the staleness window. Preferred whenever one exists — not because it is
 *      computed differently from rank 2 (it is not; the rollup does exactly
 *      shares x price) but because it is the SHARED answer, so this figure
 *      agrees with cohorts, whale detection and the dashboard.
 *   2. LIVE. Shares held x the market's current price. A fresh measurement, so
 *      it outranks a STALE mark: the Positions list argued this in a comment
 *      before the rule lived here — "a stale marked value is not trusted as a
 *      live mark ... so any gain is never a stale value minus a fresh cost
 *      basis." That reasoning was right, and it belongs in one place.
 *   3. MARKED, STALE. Still a real measurement, just an old one. Better than
 *      cost, which was never a measurement of worth at all.
 *   4. COST. The remaining acquisition cost in ETH, valued at the current rate.
 *      This is what they COMMITTED, not what it is worth — the two diverge as
 *      the price moves. For a conviction product that is a defensible fallback:
 *      the question a dust gate asks is "does this person have real skin in
 *      this", and skin is what you put in.
 *
 * Anything else is "unknown", which is zero AND says so. A caller computing a
 * gain must require a measurement (`marked` or `live`): worth minus cost, where
 * worth fell back to cost, is a guaranteed zero dressed up as a measurement.
 *
 * WHY RANK 2 EXISTS AT ALL. It was already in the product — computed inline in
 * `MyConvictions`, with a price chain that ended `?? 0`. A market the read model
 * had no price for produced `shares x 0 = 0`, and the row was then dropped by an
 * `if (!(value > 0))` filter. The holder's own position vanished from their own
 * Positions list. Not shown as unpriced — gone.
 *
 * ZERO IO, pure, fully testable.
 */

/** Where a USD figure came from. `unknown` means we genuinely cannot say. */
export type ValueSource = "marked" | "live" | "cost" | "unknown";

/**
 * How much a reader should trust the figure, in the four states that actually
 * differ:
 *
 *   · current  — marked from live prices, recently.
 *   · stale    — marked, but the writer has not run in a while. Still a real
 *                measurement; just an old one, and worth saying so.
 *   · fallback — no valuation at all; this is what they COMMITTED.
 *   · unknown  — we have nothing. The number is zero and means nothing.
 */
export type ValueFreshness = "current" | "stale" | "fallback" | "unknown";

export const VALUE = {
  /**
   * How old a marked value may be before it is called stale. `belief-rollup`
   * re-evaluates every couple of minutes, so half an hour of silence means the
   * writer is down rather than the market being quiet.
   */
  staleAfterMs: 30 * 60_000,
} as const;

export interface PositionValue {
  /** USD. Zero when unknown — always check `source` before claiming anything. */
  usd: number;
  source: ValueSource;
  freshness: ValueFreshness;
}

const finite = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Value one side of a belief.
 *
 * @param valueUsd       A marked USD valuation, if one exists.
 * @param valueUpdatedAt When that valuation was written. Absent → assumed stale,
 *                       because an unknown age is not a fresh one.
 * @param shares         Shares held on this side, for the live mark.
 * @param priceUsd       Current per-share price. Missing means we cannot mark
 *                       live — it does NOT mean the price is zero.
 * @param costEth        Remaining acquisition cost, in ETH.
 * @param ethUsd         Current ETH→USD rate. Zero or missing disables the
 *                       fallback rather than pricing everything at nothing.
 */
export function positionValueUsd(input: {
  valueUsd?: unknown;
  valueUpdatedAt?: string | number | null;
  shares?: unknown;
  priceUsd?: unknown;
  costEth?: unknown;
  ethUsd?: number | null;
  nowMs?: number;
}): PositionValue {
  const marked = finite(input.valueUsd);
  let markedStale: number | null = null;
  if (marked != null && marked > 0) {
    const at =
      typeof input.valueUpdatedAt === "number"
        ? input.valueUpdatedAt
        : input.valueUpdatedAt
          ? Date.parse(input.valueUpdatedAt)
          : NaN;
    const now = input.nowMs ?? Date.now();
    // No timestamp means we cannot show it is fresh, and "cannot show" is not
    // "is" — the same rule this whole module exists to enforce.
    const fresh = Number.isFinite(at) && now - at <= VALUE.staleAfterMs;
    if (fresh) return { usd: marked, source: "marked", freshness: "current" };
    // Hold it. A stale mark still beats cost — but only after we have tried to
    // mark it live, which is the whole reason this rank exists.
    markedStale = marked;
  }

  // Both must be real. A missing price is "we cannot mark this", never zero:
  // `shares x 0` is a confident claim that a holding is worthless.
  const shares = finite(input.shares);
  const price = finite(input.priceUsd);
  if (shares != null && shares > 0 && price != null && price > 0) {
    return { usd: shares * price, source: "live", freshness: "current" };
  }

  if (markedStale != null) return { usd: markedStale, source: "marked", freshness: "stale" };

  const cost = finite(input.costEth);
  const rate = finite(input.ethUsd);
  if (cost != null && cost > 0 && rate != null && rate > 0) {
    return { usd: cost * rate, source: "cost", freshness: "fallback" };
  }
  return { usd: 0, source: "unknown", freshness: "unknown" };
}

/** Is this figure a measurement of worth, rather than a stand-in for it? */
export function isMeasured(v: PositionValue): boolean {
  return v.source === "marked" || v.source === "live";
}

/**
 * The ETH cost basis in USD, or null when it cannot be known.
 *
 * Null rather than zero on purpose, and it is the whole point of this helper:
 * a caller comparing worth against cost must be able to tell "they put in
 * nothing" from "we have no rate", and only one of those is a fact.
 */
export function costBasisUsd(ethCost: unknown, ethUsd: number | null | undefined): number | null {
  const eth = finite(ethCost);
  const rate = finite(ethUsd);
  if (eth == null || eth <= 0 || rate == null || rate <= 0) return null;
  return eth * rate;
}
