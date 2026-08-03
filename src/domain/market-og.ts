/**
 * Market Open Graph — the compact invitation a shared link becomes.
 *
 * A preview is not a website card; it is a challenge to enter the market. It must
 * communicate, at a glance: the question, the CURRENT YES/NO state, and ONE
 * strongest proof point — never every metric, and never a forecast dressed as a
 * fact. This module picks that single signal and writes honest copy for it.
 *
 * ZERO IO, deterministic, fully testable. The route supplies live state; this
 * decides what to say about it.
 */

export interface MarketOgInput {
  question: string | null | undefined;
  /** Current share of YES, 0–100, or null when unpriced. */
  yesPct: number | null | undefined;
  /** Directional believers now. */
  believers: number | null | undefined;
  /** Committed capital now, in USD. */
  capitalUsd: number | null | undefined;
  /** New believers over a RECENT window (movement, not a total). */
  newBelievers: number | null | undefined;
  /** The window those new believers arrived in, e.g. "today" / "this week". */
  newBelieversWindow: string | null | undefined;
}

export interface MarketOg {
  /** og:title — the question itself. */
  title: string;
  /** og:description — current state + one proof point + an invitation. */
  description: string;
}

const TITLE_MAX = 70;

function clip(s: string, max: number): string {
  const t = s.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function fmtUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return `$${Math.round(n)}`;
}

/**
 * The single strongest proof point, or null when the market has no story yet.
 * Priority favours the most inviting honest signal: a genuinely close race, then
 * fresh momentum (labelled as recent), then committed capital, then crowd size.
 * Nothing here is a projection — every figure is current or a recent change.
 */
function pickProof(i: MarketOgInput, yes: number | null): string | null {
  const believers = num(i.believers);
  const capital = num(i.capitalUsd);
  const fresh = num(i.newBelievers);
  const window = (i.newBelieversWindow ?? "").trim();

  // A close race is the strongest invitation — but only once enough people are in
  // for "close" to mean anything.
  if (yes != null && Math.abs(yes - 50) <= 5 && believers >= 4) return "Too close to call";
  // Recent movement — explicitly a change, never a prediction.
  if (fresh >= 3) return `+${fresh} new believers${window ? ` ${window}` : ""}`;
  if (capital >= 100) return `${fmtUsd(capital)} committed`;
  if (believers >= 2) return `${believers} believers`;
  if (believers === 1) return "First believer just arrived";
  return null;
}

function num(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export function composeMarketOg(i: MarketOgInput): MarketOg {
  const q = (i.question ?? "").trim();
  const title = q ? clip(q, TITLE_MAX) : "A market on Conviction";

  const yes =
    typeof i.yesPct === "number" && Number.isFinite(i.yesPct)
      ? Math.max(0, Math.min(100, Math.round(i.yesPct)))
      : null;
  const state = yes != null ? `${yes}% YES · ${100 - yes}% NO` : null;
  const proof = pickProof(i, yes);

  const lead = [state, proof].filter(Boolean).join(" — ");
  const description = lead ? `${lead}. Pick a side.` : "Pick a side. Stand on business.";
  return { title, description };
}
