/**
 * ONE UNIT FOR "HOW FAR DID THE PRICE MOVE".
 *
 * `market_state.yes_price_change_24h` is stored as a PERCENT (-12.117 means the
 * YES price is down 12.1%), because that is what the market panel prints. Copy
 * elsewhere in the product speaks in RELATIVE fractions (-0.121) and formats
 * with `Math.round(rel * 100)`. Feeding the stored percent straight into that
 * formatter multiplies by a hundred twice — which is how the Insider feed came
 * to announce "YES FELL 1212%" for a market the panel correctly showed at -12%.
 *
 * Every reader that wants a fraction converts here, so the unit boundary is
 * named in one place instead of guessed at each call site.
 */

/** Stored percent (−12.117) → relative fraction (−0.12117). */
export function relFromStoredPct(pct: number | null | undefined): number | null {
  return typeof pct === "number" && Number.isFinite(pct) ? pct / 100 : null;
}
