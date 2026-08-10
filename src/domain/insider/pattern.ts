/**
 * PATTERNS — evidence accumulation. fact + fact + fact → one stronger clue.
 *
 * The editorial ladder is: Receipt → Observation → Clue → Pattern → Investigation.
 * Insider already produces the first three well, but it prints corroborating
 * observations as SEPARATE cards. Two surveillance photos of the same table are
 * one story, not two — so this composer reads the standing evidence for a market
 * and, when several observations point at the same underlying truth, merges them
 * into ONE dossier that consumes its constituents.
 *
 * It works from STRUCTURED evidence, never rendered prose — the same discipline
 * the provenance leaks taught us. An observation carries its signed price move and
 * the opposite side's occupancy as numbers, so the composer can tell "rose 15%"
 * from "fell 40%" without parsing a headline.
 *
 * Two patterns are detected here, both straight out of the corpus:
 *   • PRICE-INDIFFERENT   the same long-held positions sat through several proven
 *                         moves (especially in BOTH directions) → they are not
 *                         reacting to price.
 *   • UNCONTESTED         one side has been held for a long time, price moved, and
 *                         the other side is STILL empty → nobody will disagree.
 *
 * Pure, ZERO IO, deterministic. `PatternObservation` is a structural subset of a
 * standing row plus its structured contrast; a `StandingStoryRow` enriched with
 * `priceMove`/`oppositeBelievers` satisfies it.
 */
import type { Side } from "./types";

/** How much of a proven move makes stillness informative (mirrors STANDING_INTEL). */
const MIN_MOVE = 0.06;
const SOFT_MOVE = 0.03;
/** A hold long enough that "still there" is a contrast (mirrors STANDING_INTEL). */
const MIN_DAYS = 7;

export type PatternKind = "price_indifferent" | "uncontested_conviction";

/** One standing observation, as structured evidence the composer can reason over. */
export interface PatternObservation {
  /** The standing row's stable key — what a dossier CONSUMES so it cannot re-print. */
  key: string;
  marketId: number;
  marketTitle: string;
  side: Side;
  /** Long-held positions this observation is about. */
  holderCount: number;
  /** The longest tenure among them, in days. */
  maxDaysHeld: number;
  /** Signed proven move for this observation's window (+0.15 = up 15%); null = not price-based. */
  priceMove?: number | null;
  /** Believers on the OPPOSITE side right now. 0 is meaningful; null is unknown. */
  oppositeBelievers?: number | null;
  /** The standing kind, kept for provenance. */
  kind: string;
  /** 0..1 baseline significance of the single observation. */
  strength: number;
}

export interface PatternDossier {
  kind: PatternKind;
  marketId: number;
  side: Side;
  /** The composed lead, in PI voice. */
  headline: string;
  body: string;
  /** The one question the accumulated evidence earns. */
  question: string;
  /** Strictly greater than any single constituent — a pattern outranks its parts. */
  strength: number;
  /** Observation keys this dossier absorbs; they must NOT also print. */
  consumes: string[];
  /** Same as `consumes` — diagnostics / echo check. */
  members: string[];
}

const other = (side: Side): Side => (side === "YES" ? "NO" : "YES");
const pct = (rel: number): string => `${Math.round(Math.abs(rel) * 100)}%`;
const positions = (n: number): string => (n === 1 ? "position" : "positions");

function group<T>(rows: readonly T[], key: (r: T) => string | number): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const k = String(key(r));
    const list = out.get(k);
    if (list) list.push(r);
    else out.set(k, [r]);
  }
  return out;
}

/** PRICE-INDIFFERENT: same side, ≥2 proven moves, the same holders held through. */
function priceIndifferent(marketObs: readonly PatternObservation[]): PatternDossier[] {
  const out: PatternDossier[] = [];
  for (const [, sideObs] of group(marketObs, (o) => o.side)) {
    const moves = sideObs.filter(
      (o) => o.priceMove != null && Math.abs(o.priceMove) >= MIN_MOVE && o.holderCount >= 1,
    );
    if (moves.length < 2) continue;
    const side = moves[0]!.side;
    const ups = moves.filter((o) => o.priceMove! > 0);
    const downs = moves.filter((o) => o.priceMove! < 0);
    const both = ups.length > 0 && downs.length > 0;
    const n = Math.max(...moves.map((o) => o.holderCount));
    const biggestUp = ups.length ? Math.max(...ups.map((o) => o.priceMove!)) : 0;
    const biggestDown = downs.length ? Math.min(...downs.map((o) => o.priceMove!)) : 0;

    const body = both
      ? `${side} rose ${pct(biggestUp)} and fell ${pct(biggestDown)}. The same ${n} long-held ${positions(n)} never moved.`
      : `${side} moved ${pct(moves[0]!.priceMove!)} more than once. The same ${n} long-held ${positions(n)} stayed put.`;

    out.push({
      kind: "price_indifferent",
      marketId: moves[0]!.marketId,
      side,
      headline: "THEY'RE NOT WATCHING THE PRICE",
      body,
      question: "What are they seeing that the price isn't?",
      // A pattern outranks its loudest part; both-directions is the strongest case.
      strength: Math.min(1, Math.max(...moves.map((o) => o.strength)) + (both ? 0.2 : 0.12)),
      consumes: moves.map((o) => o.key),
      members: moves.map((o) => o.key),
    });
  }
  return out;
}

/** UNCONTESTED: long-held one side, price moved, the other side STILL empty. */
function uncontested(marketObs: readonly PatternObservation[]): PatternDossier[] {
  const oneSided = marketObs.find(
    (o) => o.oppositeBelievers === 0 && o.maxDaysHeld >= MIN_DAYS && o.holderCount >= 1,
  );
  if (!oneSided) return [];
  // A proven move on the occupied side sharpens it, but tenure alone is enough.
  const move = marketObs.find(
    (o) =>
      o.side === oneSided.side &&
      o.key !== oneSided.key &&
      o.priceMove != null &&
      Math.abs(o.priceMove) >= SOFT_MOVE,
  );
  const days = Math.floor(oneSided.maxDaysHeld);
  const n = oneSided.holderCount;
  const body = move
    ? `${oneSided.side} ${move.priceMove! < 0 ? "fell" : "rose"} ${pct(move.priceMove!)}. The same ${n} long-held ${positions(n)} stayed put.`
    : `${n} long-held ${positions(n)} on ${oneSided.side}, and ${other(oneSided.side)} still has nobody.`;
  const consumes = [oneSided.key, ...(move ? [move.key] : [])];
  return [
    {
      kind: "uncontested_conviction",
      marketId: oneSided.marketId,
      side: oneSided.side,
      headline: `${days} DAYS. STILL NO ONE ON ${other(oneSided.side)}.`,
      body,
      question: "What would it take for someone to disagree?",
      strength: Math.min(1, Math.max(oneSided.strength, move?.strength ?? 0) + (move ? 0.18 : 0.1)),
      consumes,
      members: consumes,
    },
  ];
}

/**
 * Every pattern the standing evidence supports, strongest first. An observation
 * is consumed by at most ONE dossier — the strongest — so nothing is both
 * absorbed and printed.
 */
export function accumulatePatterns(observations: readonly PatternObservation[]): PatternDossier[] {
  const candidates: PatternDossier[] = [];
  for (const [, marketObs] of group(observations, (o) => o.marketId)) {
    candidates.push(...priceIndifferent(marketObs));
    candidates.push(...uncontested(marketObs));
  }
  candidates.sort((a, b) => b.strength - a.strength || a.marketId - b.marketId);
  const consumed = new Set<string>();
  const out: PatternDossier[] = [];
  for (const c of candidates) {
    if (c.consumes.some((k) => consumed.has(k))) continue; // its evidence is spoken for
    for (const k of c.consumes) consumed.add(k);
    out.push(c);
  }
  return out;
}
