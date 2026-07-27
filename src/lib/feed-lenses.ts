/**
 * Conviction Feed — the intent engine.
 *
 * A feed is not a database query with a sort order. It is an OPINION. Every lens
 * answers a different human question, and scores the SAME market completely
 * differently depending on that question:
 *
 *   🔥 Hot        — "What is alive right now?"
 *   🧠 Conviction — "What beliefs have the strongest conviction?"
 *   👥 Tribe      — "What are people like me doing?"
 *   ⚔️ Rivals     — "What does my opposite believe?"
 *   🌱 Early      — "What's taking off before the crowd?"
 *   💎 Hidden     — "What's underrated?"
 *
 * The UI never exposes a formula. It exposes the lens and a human explanation of
 * why each market surfaced. Categories are NOT a lens — they only narrow the
 * candidate set, then the active lens ranks what remains.
 *
 * ZERO IO. Pure and fully unit-tested. Honesty rule: a market's `reason` may only
 * assert what its signals prove — no signal, no claim.
 */
import { pulse } from "./market-vitals";

export type LensKey = "hot" | "conviction" | "tribe" | "rivals" | "early" | "hidden";

export interface LensMeta {
  key: LensKey;
  emoji: string;
  label: string;
  question: string;
}

export const LENSES: LensMeta[] = [
  { key: "hot", emoji: "🔥", label: "Hot", question: "What is alive right now?" },
  { key: "conviction", emoji: "🧠", label: "Conviction", question: "Where is belief strongest?" },
  { key: "tribe", emoji: "👥", label: "My Tribe", question: "What are people like me doing?" },
  { key: "rivals", emoji: "⚔️", label: "Rivals", question: "What does my opposite believe?" },
  { key: "early", emoji: "🌱", label: "Early", question: "What's taking off before the crowd?" },
  { key: "hidden", emoji: "💎", label: "Hidden Gems", question: "What's underrated?" },
];

/**
 * Everything a market can contribute to any lens. Fields that aren't plumbed yet
 * are `null`; the scorer excludes a null signal and renormalises the remaining
 * weights, so a lens sharpens automatically as more signals arrive.
 */
export interface MarketSignals {
  onchainId: number;
  category: string | null;
  volumeTotalUsd: number; // all money ever traded
  volumeWindowUsd: number; // recent (windowed) volume
  poolUsd: number; // capital currently held (yes + no)
  believers: number; // independent believers
  newBelievers: number; // recent new believers
  velocity: number; // recent trade velocity
  convictionAvg: number | null; // avg conviction 0..1
  avgDaysHeld: number | null; // avg holding time (days)
  ageDays: number | null; // market age (days)
  flipRate: number | null; // 0..1 churn/selling — lower is stickier
  tribeMatchPct: number | null; // strongest tribe member here, 0..100
  oppMatchPct: number | null; // strongest opposite here, 0..100 (low = very opposed)
  tribeSide: "YES" | "NO" | null;
  oppSide: "YES" | "NO" | null;
  comments: number | null;
  shares: number | null;
}

export interface ScoredMarket {
  onchainId: number;
  score: number; // 0..100 for the active lens
  reason: string; // the human "why this is here", provable-only
}

// ---------------------------------------------------------------------------
// Signal derivation + batch normalisation
// ---------------------------------------------------------------------------

/** Turnover = money traded ÷ money still held. The circulation signal. */
function turnover(m: MarketSignals): number | null {
  if (!(m.poolUsd > 0)) return null;
  return m.volumeTotalUsd / m.poolUsd;
}

/** Min-max a column to 0..1. Nulls stay null (excluded downstream). A flat
 *  column maps to a neutral 0.5 so it neither helps nor hurts. */
function normColumn(vals: (number | null)[]): (number | null)[] {
  const nums = vals.filter((x): x is number => x != null && Number.isFinite(x));
  if (nums.length === 0) return vals.map(() => null);
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  const span = hi - lo;
  return vals.map((x) =>
    x == null || !Number.isFinite(x) ? null : span <= 0 ? 0.5 : (x - lo) / span,
  );
}

type SignalKey =
  | "circulation"
  | "recentVolume"
  | "velocity"
  | "newBelievers"
  | "believers"
  | "capital"
  | "conviction"
  | "daysHeld"
  | "age"
  | "retention" // 1 - flipRate
  | "tribe"
  | "opp" // opposition strength = 1 - matchPct/100 (only when genuinely opposed)
  | "comments"
  | "shares";

const RAW: Record<SignalKey, (m: MarketSignals) => number | null> = {
  circulation: (m) => turnover(m),
  recentVolume: (m) => m.volumeWindowUsd,
  velocity: (m) => m.velocity,
  newBelievers: (m) => m.newBelievers,
  believers: (m) => m.believers,
  capital: (m) => m.poolUsd,
  conviction: (m) => m.convictionAvg,
  daysHeld: (m) => m.avgDaysHeld,
  age: (m) => m.ageDays,
  retention: (m) => (m.flipRate == null ? null : 1 - Math.max(0, Math.min(1, m.flipRate))),
  tribe: (m) => (m.tribeMatchPct == null ? null : m.tribeMatchPct),
  opp: (m) => (m.oppMatchPct == null ? null : 100 - m.oppMatchPct),
  comments: (m) => m.comments,
  shares: (m) => m.shares,
};

interface Term {
  signal: SignalKey;
  weight: number;
  invert?: boolean; // reward the LOW end (e.g. "low capital", "few believers", "young")
}

// Weights straight from the intent spec. A lens only counts the terms whose
// signal is present for a given market, renormalising over what's available.
const FORMULAS: Record<LensKey, Term[]> = {
  hot: [
    { signal: "recentVolume", weight: 0.4 },
    { signal: "circulation", weight: 0.25 },
    { signal: "newBelievers", weight: 0.2 },
    { signal: "shares", weight: 0.1 },
    { signal: "comments", weight: 0.05 },
  ],
  conviction: [
    { signal: "conviction", weight: 0.35 },
    { signal: "daysHeld", weight: 0.25 },
    { signal: "capital", weight: 0.2 },
    { signal: "believers", weight: 0.15 },
    { signal: "retention", weight: 0.05 },
  ],
  tribe: [
    { signal: "tribe", weight: 0.55 },
    { signal: "conviction", weight: 0.2 },
    { signal: "recentVolume", weight: 0.15 },
    { signal: "daysHeld", weight: 0.1 },
  ],
  rivals: [
    { signal: "opp", weight: 0.6 },
    { signal: "conviction", weight: 0.2 },
    { signal: "recentVolume", weight: 0.1 },
    { signal: "capital", weight: 0.1 },
  ],
  early: [
    { signal: "velocity", weight: 0.35 },
    { signal: "capital", weight: 0.3, invert: true }, // low cap
    { signal: "newBelievers", weight: 0.2 },
    { signal: "age", weight: 0.15, invert: true }, // young
  ],
  hidden: [
    { signal: "conviction", weight: 0.4 },
    { signal: "retention", weight: 0.25 },
    { signal: "circulation", weight: 0.2 },
    { signal: "believers", weight: 0.15, invert: true }, // small crowd
  ],
};

/** Lenses that need a viewer's DNA graph; empty for anyone without matches. */
export const VIEWER_LENSES: LensKey[] = ["tribe", "rivals"];

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export interface ScoreContext {
  hasViewer?: boolean; // false → tribe/rivals return an empty ranking
}

/**
 * Score + rank a batch of markets through one lens. Signals are normalised
 * across the batch (a lens is inherently relative — "hottest of what's here"),
 * then combined by the lens weights over whatever signals each market has.
 * Returns markets sorted by descending score, each with its human reason.
 */
export function scoreFeed(
  lens: LensKey,
  markets: MarketSignals[],
  ctx: ScoreContext = {},
): ScoredMarket[] {
  if (markets.length === 0) return [];
  // Tribe / Rivals are meaningless without the viewer's graph.
  if (VIEWER_LENSES.includes(lens) && ctx.hasViewer === false) return [];

  const terms = FORMULAS[lens];
  const usedSignals = [...new Set(terms.map((t) => t.signal))];

  // Normalise every signal this lens uses, once, across the batch.
  const normed: Partial<Record<SignalKey, (number | null)[]>> = {};
  for (const s of usedSignals) normed[s] = normColumn(markets.map((m) => RAW[s](m)));

  const scored: ScoredMarket[] = markets.map((m, i) => {
    let acc = 0;
    let wsum = 0;
    for (const t of terms) {
      const n = normed[t.signal]![i];
      if (n == null) continue; // signal absent for this market → skip, renormalise
      acc += t.weight * (t.invert ? 1 - n : n);
      wsum += t.weight;
    }
    const score = wsum > 0 ? Math.round((acc / wsum) * 100) : 0;
    return { onchainId: m.onchainId, score, reason: reasonFor(lens, m) };
  });

  return scored.sort((a, b) => b.score - a.score || a.onchainId - b.onchainId);
}

// ---------------------------------------------------------------------------
// Reasons — the human "why", never the formula. Only claims the data proves.
// ---------------------------------------------------------------------------

function reasonFor(lens: LensKey, m: MarketSignals): string {
  switch (lens) {
    case "hot": {
      const p = pulse(m.volumeTotalUsd, m.poolUsd);
      if (p.level === "alive" || p.level === "active") return p.line;
      if (m.newBelievers > 0) return `${m.newBelievers} new believers just arrived.`;
      return "Money is moving here right now.";
    }
    case "conviction": {
      if (m.avgDaysHeld != null && m.avgDaysHeld >= 1)
        return `Holders here haven't sold for ${Math.round(m.avgDaysHeld)} days on average.`;
      if (m.convictionAvg != null && m.convictionAvg > 0)
        return "Steady, high-conviction backing — not a quick flip.";
      if (m.poolUsd > 0) return "Real capital is standing behind this belief.";
      return "A belief people are standing by.";
    }
    case "tribe": {
      const side = m.tribeSide ? ` on ${m.tribeSide}` : "";
      if (m.tribeMatchPct != null)
        return `People with ${Math.round(m.tribeMatchPct)}% Conviction DNA are backing this${side}.`;
      return `People like you are backing this${side}.`;
    }
    case "rivals": {
      const side = m.oppSide ? ` into ${m.oppSide}` : "";
      return `Your opposites are piling in${side} — the other side of your conviction.`;
    }
    case "early": {
      const crowd = m.believers > 0 ? ` — still under ${Math.max(m.believers, 1)} believers` : "";
      if (m.newBelievers > 0) return `Believers are climbing fast${crowd}.`;
      if (m.velocity > 0) return `Picking up speed early${crowd}.`;
      return `Fresh and small${crowd} — before the crowd notices.`;
    }
    case "hidden": {
      const bits: string[] = [];
      if (m.believers > 0 && m.believers < 50) bits.push("small crowd");
      if (m.convictionAvg != null && m.convictionAvg > 0) bits.push("unusually high conviction");
      const t = turnover(m);
      if (t != null && t >= 1.6) bits.push("real circulation");
      bits.push("hardly discovered");
      return capitalize(bits.join(", ")) + ".";
    }
  }
}

// ---------------------------------------------------------------------------
// Categories — a filter, never a score.
// ---------------------------------------------------------------------------

export function marketsInCategory(
  markets: MarketSignals[],
  category: string | null,
): MarketSignals[] {
  if (!category || category.toLowerCase() === "everything") return markets;
  const c = category.toLowerCase();
  return markets.filter((m) => (m.category ?? "").toLowerCase().includes(c));
}

/** Distinct categories present in the batch, for the category picker. */
export function categoriesOf(markets: MarketSignals[]): string[] {
  const seen = new Set<string>();
  for (const m of markets) {
    const c = (m.category ?? "").trim();
    if (c) seen.add(c);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}
