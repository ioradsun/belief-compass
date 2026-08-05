/**
 * WASH TRADING — activity that moved money without moving a belief.
 *
 * The live tape has always dropped these. The METRICS did not, and that gap is
 * the reason this module exists as its own thing rather than staying buried in
 * the tape's grouping pass: a market whose volume is visibly spiking while the
 * tape says nothing makes a reader distrust both numbers. A scoreboard and a
 * feed that disagree about what happened is worse than either being wrong
 * alone, because the reader cannot tell which one to believe.
 *
 * So the rule lives here, once, and both the feed and the aggregates read it.
 * Duplicating this heuristic into SQL would have been the obvious shortcut and
 * the wrong one — a second copy of a rule in a second language is exactly the
 * failure that left four surfaces reading a column nobody wrote.
 *
 * TWO PATTERNS, and the second is why the first is not enough.
 *
 *   ROUND TRIP — one buy matched to one sell, same wallet, same market, same
 *   side, same size, minutes apart. They ended where they started.
 *
 *   CHURN — measured over six hours of production: 136 trades, of which the top
 *   six sequences alone were 73, every one a perfect alternating ladder by a
 *   single wallet on a single side:
 *
 *       SELL 0.036091  BUY 0.036091  SELL 0.038493  BUY 0.038493  … ×8
 *
 *   Three wallets produced over half of all platform "activity" that way.
 *   Pairwise matching does eventually reject each pair, but only if every pair
 *   lands inside a 15-minute window at under 2% size difference — so a churner
 *   who widens either dimension slightly walks straight back in, and arrives as
 *   an aggregated "sweep", the loudest row the feed has.
 *
 *   So the PATTERN is judged, not the pair: a wallet with enough trades on one
 *   (market, side) whose buying and selling BALANCE has taken no position and
 *   expressed no belief. Balance is the honest test — it cannot be evaded by
 *   jittering sizes or spacing, only by taking real directional risk, which is
 *   precisely the thing this product is about.
 *
 * WHAT THIS IS NOT. It does not judge intent, and it never says "wash trader".
 * A market maker quoting both sides is doing something legitimate and would
 * still be flagged, correctly: their activity is real, and it is still not a
 * belief. The flag answers one narrow question — did this express conviction? —
 * and nothing else may be inferred from it.
 *
 * BOTH LEGS ARE FLAGGED. The feed drops the sell and renders the buy as a
 * `round_trip` row, which the admission gate then refuses; the net effect is
 * that neither leg reaches a reader. Metrics must match that net effect, so
 * both legs are flagged here.
 *
 * ZERO IO, pure, fully testable.
 */

export const WASH = {
  /** Below this it is trading, not a pattern. Six is three full cycles. */
  minTrades: 6,
  /** How closely buy and sell volume must match to read as "went nowhere". */
  balanceTolerance: 0.1,
  /** How long a churn pattern is judged over. */
  churnWindowMs: 2 * 60 * 60_000,
  /** How close a buy and a sell must be in time to pair as one round trip. */
  roundTripWindowMs: 15 * 60_000,
  /** Size difference that still counts as the same position, reversed. */
  roundTripTolerance: 0.02,
} as const;

/** Why a trade does not count as conviction. */
export type WashReason = "churn" | "round_trip";

/** The minimum a trade must carry to be judged. Deliberately not a DB row. */
export interface JudgeableTrade {
  /** Stable identity — `source_key` in the events log. */
  key: string;
  wallet: string | null;
  marketId: string;
  side: "YES" | "NO" | null;
  action: "BUY" | "SELL" | null;
  /** ETH. The unit only has to be consistent; balance is a ratio. */
  amountEth: number;
  occurredAt: string;
}

const t = (x: JudgeableTrade) => Date.parse(x.occurredAt);

/**
 * Wallets that went nowhere, loudly.
 *
 * Judged per (wallet, market, side) over a rolling window anchored on that
 * actor's newest trade — not on wall-clock now, so a pattern that finished
 * hours ago is still recognised as what it was.
 */
function findChurn(trades: JudgeableTrade[], out: Map<string, WashReason>): void {
  const byActor = new Map<string, JudgeableTrade[]>();
  for (const x of trades) {
    if (!x.wallet || !x.action) continue;
    const k = `${x.wallet.toLowerCase()}:${x.marketId}:${x.side}`;
    const list = byActor.get(k) ?? [];
    list.push(x);
    byActor.set(k, list);
  }
  for (const list of byActor.values()) {
    if (list.length < WASH.minTrades) continue;
    const newest = t(list[0]);
    const near = list.filter((x) => newest - t(x) <= WASH.churnWindowMs);
    if (near.length < WASH.minTrades) continue;
    let bought = 0;
    let sold = 0;
    for (const x of near) {
      if (x.action === "BUY") bought += x.amountEth;
      else sold += x.amountEth;
    }
    const base = Math.max(bought, sold, Number.EPSILON);
    // Balanced both ways: they ended where they started.
    if (Math.abs(bought - sold) / base <= WASH.balanceTolerance) {
      for (const x of near) out.set(x.key, "churn");
    }
  }
}

/** One buy matched to one sell — the same position, taken and given back. */
function findRoundTrips(trades: JudgeableTrade[], out: Map<string, WashReason>): void {
  const paired = new Set<string>();
  for (let a = 0; a < trades.length; a += 1) {
    const sell = trades[a];
    if (sell.action !== "SELL" || !sell.wallet || paired.has(sell.key)) continue;
    for (let b = a + 1; b < trades.length; b += 1) {
      const buy = trades[b];
      // Input is newest-first, so anything past the window is out of reach.
      if (t(sell) - t(buy) > WASH.roundTripWindowMs) break;
      if (
        buy.action !== "BUY" ||
        buy.wallet !== sell.wallet ||
        buy.marketId !== sell.marketId ||
        buy.side !== sell.side ||
        paired.has(buy.key)
      )
        continue;
      const base = Math.max(buy.amountEth, sell.amountEth, Number.EPSILON);
      if (Math.abs(buy.amountEth - sell.amountEth) / base > WASH.roundTripTolerance) continue;
      paired.add(sell.key);
      paired.add(buy.key);
      // Churn is the stronger statement about the same trade; never downgrade it.
      if (!out.has(sell.key)) out.set(sell.key, "round_trip");
      if (!out.has(buy.key)) out.set(buy.key, "round_trip");
      break;
    }
  }
}

/**
 * Judge a set of trades. Returns only the ones that expressed no belief, keyed
 * by identity, with the reason.
 *
 * @param trades Newest first. Sorted defensively, because a caller reading from
 *   SQL and a caller reading the tape's own buffer must reach the same verdict —
 *   a rule that depends on input order is a rule with two answers.
 */
export function findWashTrades(trades: JudgeableTrade[]): Map<string, WashReason> {
  const out = new Map<string, WashReason>();
  if (trades.length === 0) return out;
  const ordered = [...trades].sort((x, y) => t(y) - t(x) || x.key.localeCompare(y.key));
  findChurn(ordered, out);
  findRoundTrips(ordered, out);
  return out;
}
