/**
 * The side panel's plain-language summary — one sentence that says what the
 * side IS right now, and (only when something actually moved) one sentence that
 * says what changed. Never filler: "no change" states return null so the panel
 * can use whitespace instead of repeating "Flat today" three times.
 */

export type Side = "YES" | "NO";

/** "Nobody backs YES right now." / "18 people back YES." */
export function sideStateLine(side: Side, believers: number | null): string {
  if (believers == null) return `${side}`;
  if (believers <= 0) return `Nobody backs ${side} right now.`;
  if (believers === 1) return `1 person backs ${side}.`;
  return `${believers.toLocaleString("en-US")} people back ${side}.`;
}

export function sideChangeLine({
  side,
  belDelta,
  capDelta,
  priceDelta,
  phrase,
  money,
}: {
  side: Side;
  /** Change in believer count over the window. */
  belDelta: number | null;
  /** Change in capital held, in USD. */
  capDelta: number | null;
  /** Change in price per share, in USD. */
  priceDelta: number | null;
  /** e.g. "today" / "over 1W". */
  phrase: string;
  money: (usd: number) => string;
}): string | null {
  const bel = belDelta != null && belDelta !== 0 ? belDelta : 0;
  const cap = capDelta != null && Math.abs(capDelta) >= 0.005 ? capDelta : 0;
  const price = priceDelta != null && Math.abs(priceDelta) >= 0.005 ? priceDelta : 0;
  if (!bel && !cap && !price) return null;

  const lead = cap
    ? `${side} is ${cap > 0 ? "gaining" : "losing"} capital.`
    : bel
      ? `${side} is ${bel > 0 ? "gaining" : "losing"} believers.`
      : `${side} price ${price > 0 ? "rose" : "eased"}.`;

  const parts: string[] = [];
  if (bel) {
    const n = Math.abs(bel);
    parts.push(
      bel > 0
        ? `${n} new believer${n === 1 ? "" : "s"} joined`
        : `${n} believer${n === 1 ? "" : "s"} left`,
    );
  }
  if (cap) {
    parts.push(
      cap > 0 ? `${money(Math.abs(cap))} was committed` : `${money(Math.abs(cap))} left the side`,
    );
  }
  if (price) {
    parts.push(`the price per share ${price > 0 ? "rose" : "fell"} ${money(Math.abs(price))}`);
  }

  const detail =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `${lead} ${detail.charAt(0).toUpperCase()}${detail.slice(1)} ${phrase}.`;
}
