/**
 * conviction.company — pure belief math.
 *
 * ZERO dependencies. Never reads Date.now(), the network, or a DB.
 * Two operations only:
 *   applyTrade(prior, trade)   → trade-driven state (no prices)
 *   evaluate(row, prices, now) → price-driven view  (no state mutation)
 *
 * Invariants (see domain.test.ts):
 *   (a) evaluate never mutates expressed_side or directional_since
 *   (b) reduce(all) === reduce(a) + reduce(b) for any split
 *   (c) idempotent replay of ordered trades → same row
 */

export const THRESHOLD = 0.1;
export const EPSILON = 1e-9;
export const SIZE_CAP_USD = 1000;
export const PERSISTENCE_CAP_DAYS = 90;
export const CONVICTION_FLOOR = 0.6;
export const CONVICTION_SIZE_W = 0.2;
export const CONVICTION_PERSIST_W = 0.2;

export type Side = "YES" | "NO" | "MIXED" | "INACTIVE";
export type Direction = "BUY" | "SELL";

export interface BeliefRow {
  yes_shares: number;
  no_shares: number;
  // Remaining acquisition cost in ETH (folded from each trade's eth_amount).
  // Readers value it in USD at the current rate before comparing with worth.
  yes_cost: number;
  no_cost: number;
  expressed_side: Side; // from applyTrade only
  /**
   * THE LAST SIDE THIS WALLET ACTUALLY TOOK HERE — set when the position becomes
   * directional and NEVER cleared, not on a partial sell, not on a full exit.
   *
   * `expressed_side` answers "where do they stand now" and goes INACTIVE the
   * moment they leave, taking the direction with it. That is why DNA could not
   * remember a conviction anyone had exited: nothing in the row survived to say
   * which way they had gone. This is the survivor.
   *
   * WHAT IT DOES NOT KEEP, and the copy must never imply otherwise. One field
   * holds one answer: the MOST RECENT directional side. A wallet that went
   * YES → exit → NO → exit reads NO, and the earlier YES is gone. DNA is one
   * factor per market, so the latest conviction is the right single
   * representation — but "we remember every time you agreed" would be false.
   * "Past convictions still count, with less weight than positions you hold
   * today" is true, and is what the product may say.
   */
  last_directional_side: "YES" | "NO" | null;
  directional_since: Date | null;
  first_backed_at: Date | null;
  last_trade_at: Date | null;
}

export interface Trade {
  side: "YES" | "NO";
  direction: Direction;
  token_amount: number; // shares
  // Acquisition cost / sale proceeds in ETH (position-core folds amount_eth/1e18).
  // NOT USD — yes_cost/no_cost accumulate ETH; a caller values them at a USD rate.
  eth_amount: number;
  ts: Date;
}

export interface Prices {
  yesPriceUsd: number;
  noPriceUsd: number;
}

export interface EvaluatedView {
  yes_value: number;
  no_value: number;
  position_value_usd: number;
  stance: number; // -1..+1, economic (from live prices)
  stance_side: Side;
  days_held: number;
  conviction: number; // 0..1
}

export const emptyRow = (): BeliefRow => ({
  yes_shares: 0,
  no_shares: 0,
  yes_cost: 0,
  no_cost: 0,
  expressed_side: "INACTIVE",
  last_directional_side: null,
  directional_since: null,
  first_backed_at: null,
  last_trade_at: null,
});

// Classify a wallet's expressed side from TOKEN SHARES (never USD).
// Applied in applyTrade so the reducer stays price-free.
export function classifyByShares(yes: number, no: number): Side {
  const total = yes + no;
  if (total < EPSILON) return "INACTIVE";
  const r = (yes - no) / Math.max(total, EPSILON);
  if (r >= THRESHOLD) return "YES";
  if (r <= -THRESHOLD) return "NO";
  return "MIXED";
}

// Classify by economic value (evaluate). Distinct from expressed side.
export function classifyByValue(yesV: number, noV: number): Side {
  const total = yesV + noV;
  if (total < EPSILON) return "INACTIVE";
  const s = (yesV - noV) / Math.max(total, EPSILON);
  if (s >= THRESHOLD) return "YES";
  if (s <= -THRESHOLD) return "NO";
  return "MIXED";
}

/**
 * applyTrade: fold one canonical trade into the row.
 * Trade-driven only — NEVER reads a price.
 * Cost basis: weighted-average remaining acquisition cost.
 *   BUY:  new_cost = existing_cost + purchase_cost
 *   SELL: new_cost = existing_cost * (1 - sold/shares_before)   (proportional scale-down)
 *   Full exit: cost = 0
 */
export function applyTrade(prior: BeliefRow, t: Trade): BeliefRow {
  const next: BeliefRow = { ...prior };

  if (t.side === "YES") {
    const before = next.yes_shares;
    if (t.direction === "BUY") {
      next.yes_shares = before + t.token_amount;
      next.yes_cost = next.yes_cost + t.eth_amount;
    } else {
      const sold = Math.min(t.token_amount, before);
      next.yes_shares = Math.max(0, before - sold);
      if (before > EPSILON) {
        next.yes_cost = next.yes_cost * (1 - sold / before);
      }
      if (next.yes_shares < EPSILON) {
        next.yes_shares = 0;
        next.yes_cost = 0;
      }
    }
  } else {
    const before = next.no_shares;
    if (t.direction === "BUY") {
      next.no_shares = before + t.token_amount;
      next.no_cost = next.no_cost + t.eth_amount;
    } else {
      const sold = Math.min(t.token_amount, before);
      next.no_shares = Math.max(0, before - sold);
      if (before > EPSILON) {
        next.no_cost = next.no_cost * (1 - sold / before);
      }
      if (next.no_shares < EPSILON) {
        next.no_shares = 0;
        next.no_cost = 0;
      }
    }
  }

  // Timestamps
  if (next.first_backed_at == null && (next.yes_shares > 0 || next.no_shares > 0)) {
    next.first_backed_at = t.ts;
  }
  next.last_trade_at = t.ts;

  // Expressed-side transition, driven by TOKEN SHARES.
  const priorSide = prior.expressed_side;
  const newSide = classifyByShares(next.yes_shares, next.no_shares);
  next.expressed_side = newSide;

  // Remember the direction. Written whenever the wallet IS directional and left
  // untouched otherwise, so leaving a market cannot erase which way they went.
  // Monotone by construction: this branch only ever assigns a real side.
  if (newSide === "YES" || newSide === "NO") next.last_directional_side = newSide;

  // directional_since transitions per spec table
  if (priorSide === "INACTIVE" || priorSide === "MIXED") {
    if (newSide === "YES" || newSide === "NO") {
      next.directional_since = t.ts; // set
    } else {
      next.directional_since = prior.directional_since; // still null-ish
    }
  } else {
    // priorSide is YES or NO
    if (newSide === priorSide) {
      next.directional_since = prior.directional_since; // preserve
    } else if (newSide === "YES" || newSide === "NO") {
      next.directional_since = t.ts; // flip
    } else {
      next.directional_since = null; // exit → MIXED/INACTIVE
    }
  }

  return next;
}

export function reduce(trades: Trade[], initial: BeliefRow = emptyRow()): BeliefRow {
  return trades.reduce((row, t) => applyTrade(row, t), initial);
}

/**
 * The conviction core: side-values + hold time → stance & conviction. This is
 * the ONE place the formula lives, so both the on-chain path (evaluate, via
 * shares × live price) and the POV-positions path (via POV's own
 * currentValueUsd) produce the identical number. A position whose hold time is
 * unknown honestly passes daysHeld = 0 → persistence 0 (conviction floor only).
 */
export function convictionFromValues(
  yesValue: number,
  noValue: number,
  daysHeld: number,
): { position_value_usd: number; stance: number; stance_side: Side; conviction: number } {
  const position_value_usd = yesValue + noValue;
  const stance = (yesValue - noValue) / Math.max(yesValue + noValue, EPSILON);
  const stance_side = classifyByValue(yesValue, noValue);

  const direction = Math.abs(stance);
  const size = Math.min(1, Math.log(1 + position_value_usd) / Math.log(1 + SIZE_CAP_USD));
  const persistence = Math.min(
    1,
    Math.log(1 + Math.max(0, daysHeld)) / Math.log(1 + PERSISTENCE_CAP_DAYS),
  );
  const conviction =
    direction * (CONVICTION_FLOOR + CONVICTION_SIZE_W * size + CONVICTION_PERSIST_W * persistence);

  return { position_value_usd, stance, stance_side, conviction };
}

/**
 * evaluate: project row + live prices → economic view.
 * Pure; NEVER mutates the row and NEVER changes expressed_side.
 */
export function evaluate(row: BeliefRow, p: Prices, now: Date): EvaluatedView {
  const yes_value = row.yes_shares * (p.yesPriceUsd ?? 0);
  const no_value = row.no_shares * (p.noPriceUsd ?? 0);

  const days_held = row.directional_since
    ? Math.max(0, (now.getTime() - row.directional_since.getTime()) / 86_400_000)
    : 0;

  const core = convictionFromValues(yes_value, no_value, days_held);
  return {
    yes_value,
    no_value,
    position_value_usd: core.position_value_usd,
    stance: core.stance,
    stance_side: core.stance_side,
    days_held,
    conviction: core.conviction,
  };
}
