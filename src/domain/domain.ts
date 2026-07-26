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

export const THRESHOLD = 0.10;
export const EPSILON = 1e-9;
export const SIZE_CAP_USD = 1000;
export const PERSISTENCE_CAP_DAYS = 90;
export const CONVICTION_FLOOR = 0.60;
export const CONVICTION_SIZE_W = 0.20;
export const CONVICTION_PERSIST_W = 0.20;

export type Side = "YES" | "NO" | "MIXED" | "INACTIVE";
export type Direction = "BUY" | "SELL";

export interface BeliefRow {
  yes_shares: number;
  no_shares: number;
  yes_cost: number; // weighted-average remaining acquisition cost (USD)
  no_cost: number;
  expressed_side: Side; // from applyTrade only
  directional_since: Date | null;
  first_backed_at: Date | null;
  last_trade_at: Date | null;
}

export interface Trade {
  side: "YES" | "NO";
  direction: Direction;
  token_amount: number; // shares
  eth_amount: number;   // USD-equivalent cost/proceeds (upstream converts)
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
  stance: number;             // -1..+1, economic (from live prices)
  stance_side: Side;
  days_held: number;
  conviction: number;         // 0..1
}

export const emptyRow = (): BeliefRow => ({
  yes_shares: 0, no_shares: 0, yes_cost: 0, no_cost: 0,
  expressed_side: "INACTIVE",
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
      if (next.yes_shares < EPSILON) { next.yes_shares = 0; next.yes_cost = 0; }
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
      if (next.no_shares < EPSILON) { next.no_shares = 0; next.no_cost = 0; }
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

  // directional_since transitions per spec table
  if (priorSide === "INACTIVE" || priorSide === "MIXED") {
    if (newSide === "YES" || newSide === "NO") {
      next.directional_since = t.ts;                     // set
    } else {
      next.directional_since = prior.directional_since;  // still null-ish
    }
  } else {
    // priorSide is YES or NO
    if (newSide === priorSide) {
      next.directional_since = prior.directional_since;  // preserve
    } else if (newSide === "YES" || newSide === "NO") {
      next.directional_since = t.ts;                     // flip
    } else {
      next.directional_since = null;                     // exit → MIXED/INACTIVE
    }
  }

  return next;
}

export function reduce(trades: Trade[], initial: BeliefRow = emptyRow()): BeliefRow {
  return trades.reduce((row, t) => applyTrade(row, t), initial);
}

/**
 * evaluate: project row + live prices → economic view.
 * Pure; NEVER mutates the row and NEVER changes expressed_side.
 */
export function evaluate(row: BeliefRow, p: Prices, now: Date): EvaluatedView {
  const yes_value = row.yes_shares * (p.yesPriceUsd ?? 0);
  const no_value  = row.no_shares  * (p.noPriceUsd ?? 0);
  const position_value_usd = yes_value + no_value;
  const stance = (yes_value - no_value) / Math.max(yes_value + no_value, EPSILON);
  const stance_side = classifyByValue(yes_value, no_value);

  const days_held = row.directional_since
    ? Math.max(0, (now.getTime() - row.directional_since.getTime()) / 86_400_000)
    : 0;

  const direction = Math.abs(stance);
  const size = Math.min(1, Math.log(1 + position_value_usd) / Math.log(1 + SIZE_CAP_USD));
  const persistence = Math.min(1, Math.log(1 + days_held) / Math.log(1 + PERSISTENCE_CAP_DAYS));
  const conviction = direction * (CONVICTION_FLOOR + CONVICTION_SIZE_W * size + CONVICTION_PERSIST_W * persistence);

  return { yes_value, no_value, position_value_usd, stance, stance_side, days_held, conviction };
}

// ============ Conviction DNA matching ============

export interface BeliefFactor {
  onchain_id: string | number;
  stance: number;      // -1..+1
  stance_side: Side;   // must be YES or NO to count
  conviction: number;  // 0..1
}

export interface MatchResult {
  raw: number;          // -1..+1
  raw_score: number;    // 0..100
  match_score: number;  // 0..100 (confidence-adjusted)
  shared: number;
  agreements: number;
  disagreements: number;
  insufficient: boolean;
}

export const MIN_SHARED_MARKETS = 5;

export function matchScore(
  a: BeliefFactor[],
  b: BeliefFactor[],
): MatchResult {
  const byId = new Map<string, BeliefFactor>();
  for (const x of a) {
    if (x.stance_side === "YES" || x.stance_side === "NO") byId.set(String(x.onchain_id), x);
  }

  let wSum = 0;
  let wxSum = 0;
  let agreements = 0;
  let disagreements = 0;
  let shared = 0;

  for (const y of b) {
    if (y.stance_side !== "YES" && y.stance_side !== "NO") continue;
    const x = byId.get(String(y.onchain_id));
    if (!x) continue;
    shared++;
    const w = Math.sqrt(Math.max(0, x.conviction) * Math.max(0, y.conviction));
    const agree = x.stance * y.stance;
    wSum += w;
    wxSum += w * agree;
    if (x.stance_side === y.stance_side) agreements++;
    else disagreements++;
  }

  const raw = wSum > EPSILON ? wxSum / wSum : 0;
  const raw_score = 50 * (raw + 1);
  const confidence = shared / (shared + 8);
  const match_score = 50 + confidence * (raw_score - 50);
  const insufficient = shared < MIN_SHARED_MARKETS;

  return { raw, raw_score, match_score, shared, agreements, disagreements, insufficient };
}

/**
 * circleMatches — RULE 1 (honesty gate) applied per-domain.
 *
 * Partitions shared factors by the domain of each market and runs the same
 * agreement × conviction-weight × confidence formula per bucket. Factors
 * without a domain (missing category or unmapped slug) are dropped: they
 * never claim a Circle. Circles below MIN_SHARED_MARKETS return
 * `insufficient: true` and callers MUST NOT surface a number.
 */
export function circleMatches<D extends string>(
  a: BeliefFactor[],
  b: BeliefFactor[],
  domainOf: (onchainId: string | number) => D | null,
): Map<D, MatchResult> {
  const bucketsA = new Map<D, BeliefFactor[]>();
  const bucketsB = new Map<D, BeliefFactor[]>();
  for (const x of a) {
    const d = domainOf(x.onchain_id);
    if (!d) continue;
    const arr = bucketsA.get(d) ?? [];
    arr.push(x);
    bucketsA.set(d, arr);
  }
  for (const y of b) {
    const d = domainOf(y.onchain_id);
    if (!d) continue;
    const arr = bucketsB.get(d) ?? [];
    arr.push(y);
    bucketsB.set(d, arr);
  }
  const out = new Map<D, MatchResult>();
  for (const [d, arr] of bucketsA) {
    const other = bucketsB.get(d);
    if (!other) continue;
    out.set(d, matchScore(arr, other));
  }
  return out;
}

