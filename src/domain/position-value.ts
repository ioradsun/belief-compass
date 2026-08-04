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
 * TWO SOURCES, IN ORDER:
 *
 *   1. MARKED. A real USD valuation. Preferred whenever one exists, because it
 *      is what the position is worth right now.
 *   2. COST. The remaining acquisition cost in ETH, valued at the current rate.
 *      This is what they COMMITTED, not what it is worth — the two diverge as
 *      the price moves. For a conviction product that is a defensible fallback:
 *      the question a dust gate asks is "does this person have real skin in
 *      this", and skin is what you put in.
 *
 * Anything else is "unknown", which is zero AND says so. A caller computing a
 * gain must require `marked`: worth minus cost, where worth fell back to cost,
 * is a guaranteed zero dressed up as a measurement.
 *
 * ZERO IO, pure, fully testable.
 */

/** Where a USD figure came from. `unknown` means we genuinely cannot say. */
export type ValueSource = "marked" | "cost" | "unknown";

export interface PositionValue {
  /** USD. Zero when unknown — always check `source` before claiming anything. */
  usd: number;
  source: ValueSource;
}

const finite = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Value one side of a belief.
 *
 * @param valueUsd A marked USD valuation, if one exists.
 * @param costEth  Remaining acquisition cost, in ETH.
 * @param ethUsd   Current ETH→USD rate. Zero or missing disables the fallback
 *                 rather than pricing everything at nothing.
 */
export function positionValueUsd(input: {
  valueUsd?: unknown;
  costEth?: unknown;
  ethUsd?: number | null;
}): PositionValue {
  const marked = finite(input.valueUsd);
  if (marked != null && marked > 0) return { usd: marked, source: "marked" };

  const cost = finite(input.costEth);
  const rate = finite(input.ethUsd);
  if (cost != null && cost > 0 && rate != null && rate > 0) {
    return { usd: cost * rate, source: "cost" };
  }
  return { usd: 0, source: "unknown" };
}

/**
 * The ETH cost basis in USD, or null when it cannot be known.
 *
 * Null rather than zero on purpose, and it is the whole point of this helper:
 * a caller comparing worth against cost must be able to tell "they put in
 * nothing" from "we have no rate", and only one of those is a fact.
 */
export function costBasisUsd(ethCost: unknown, ethUsd: number): number | null {
  const eth = finite(ethCost);
  if (eth == null || eth <= 0 || !(ethUsd > 0)) return null;
  return eth * ethUsd;
}
