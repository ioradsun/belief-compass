/**
 * Position P&L — pure, no IO. The human layer of ownership: what you put in,
 * what it's worth, how much you gained.
 *
 * HONESTY RULE (the load-bearing one): gain is derived ONLY from an authoritative
 * cost basis (the reducer's weighted-average remaining acquisition cost, in USD)
 * against an authoritative current value (POV's valuation of the wallet's tokens).
 * It is NEVER computed from a market price percentage. A market's 24h side move
 * is how the SIDE's price changed; it is not this wallet's return relative to its
 * own cost. When cost basis is missing or zero, `invested`/`gain` are null and the
 * caller shows "worth now" (plus the market move) alone — never an invented number.
 *
 * `invested` is REMAINING cost basis: partial sells scale it down proportionally
 * (see applyTrade in domain.ts), so gain reads as unrealized gain on what's still
 * held — the correct meaning for an open position.
 */

export interface PositionPnl {
  /** Remaining cost basis in USD, or null when not authoritatively known (> 0). */
  investedUsd: number | null;
  /** Current position value in USD, or null when unknown. */
  worthUsd: number | null;
  /** worth − invested, only when both are known. Never from a market %. */
  gainUsd: number | null;
  /** gain / invested × 100, only when invested is a real positive basis. */
  gainPct: number | null;
}

const fin = (v: unknown): number | null =>
  v == null || !Number.isFinite(Number(v)) ? null : Number(v);

export function positionPnl(input: {
  invested?: number | null;
  worth?: number | null;
}): PositionPnl {
  const worthUsd = fin(input.worth);
  const investedRaw = fin(input.invested);
  // A trustworthy cost basis is a positive number. Zero means fully exited (no
  // open cost) — treat as "no invested to show", not a 0-basis division.
  const investedUsd = investedRaw != null && investedRaw > 0 ? investedRaw : null;

  if (investedUsd == null || worthUsd == null) {
    return { investedUsd, worthUsd, gainUsd: null, gainPct: null };
  }
  const gainUsd = worthUsd - investedUsd;
  return { investedUsd, worthUsd, gainUsd, gainPct: (gainUsd / investedUsd) * 100 };
}
