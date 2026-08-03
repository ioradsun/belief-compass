/**
 * Market row — what a searcher actually needs to know about a market match.
 *
 * A search result isn't a filing card; it's a decision. Scanning a list, a person
 * is asking two things: "is this the market I mean?" and "is it worth entering?"
 * A category ("culture") answers neither. The two facts that do are the market's
 * CURRENT STANCE — who's ahead, and by how much — and whether anyone's actually
 * in it. This composes exactly those, honestly: a current split (never a
 * forecast) and a plain crowd count, or an invitation when the market is new.
 *
 * ZERO IO, deterministic, fully testable.
 */

export interface MarketRowInput {
  /** Money-weighted YES share, 0–100, or null when unpriced. */
  yesPct: number | null | undefined;
  /** Directional believers now. */
  believers: number | null | undefined;
}

export interface MarketRow {
  /** Which side currently leads, or null when unpriced. */
  leadSide: "YES" | "NO" | null;
  /** The leader's rounded share (e.g. 62), or null when unpriced. */
  leadPct: number | null;
  /** "62% YES" / "58% NO" — the current split, coloured by the leader. Null when unpriced. */
  stateText: string | null;
  /** "18 believers" / "1 believer", or null when nobody's in yet. */
  crowdText: string | null;
  /** Shown only when there is no state at all — an invitation, not a blank. */
  emptyText: string | null;
}

function clampPct(v: number | null | undefined): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function count(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

export function composeMarketRow(i: MarketRowInput): MarketRow {
  const yes = clampPct(i.yesPct);
  const believers = count(i.believers);

  // The leader and its margin — a tie leans YES by convention (the affirmative).
  const leadSide: "YES" | "NO" | null = yes == null ? null : yes >= 50 ? "YES" : "NO";
  const leadPct = yes == null ? null : yes >= 50 ? yes : 100 - yes;
  const stateText = leadSide == null ? null : `${leadPct}% ${leadSide}`;

  const crowdText = believers > 0 ? `${believers} believer${believers === 1 ? "" : "s"}` : null;

  // Nothing to say yet — invite rather than show an empty row.
  const emptyText = stateText == null && crowdText == null ? "New — no side yet" : null;

  return { leadSide, leadPct, stateText, crowdText, emptyText };
}
