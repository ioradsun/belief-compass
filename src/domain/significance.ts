/**
 * SIGNIFICANCE — one scale, so the mixer compares like with like.
 *
 * The cadence mixer can only curate well if every event arrives with an honest
 * estimate of importance. Before this module, exactly one family (cohorts)
 * carried a real score and everything else fell back to 0.5 — which quietly made
 * RECENCY the primary ranker for most of the feed. A feed can look editorially
 * balanced and still bury the most important story on it.
 *
 * THE SCALE. One meaning across every family: a 0.8 cohort and a 0.8 market flip
 * are comparably important, whatever their reasons.
 *
 *   0.00–0.24  low          noise, context only
 *   0.25–0.49  contextual   true, worth a line, not worth interrupting for
 *   0.50–0.69  notable      a real change a reader would want
 *   0.70–0.84  high         changes how the market reads
 *   0.85–1.00  exceptional  the thing this product exists for happened
 *
 * "Exceptional" is reserved for the two things this product is built to change: a
 * MARKET's own answer flipping, and a READER meeting the person who thinks like
 * them — or the one who never does. Markets are the evidence; people are the
 * point, so a Twin or an Opp appearing sits alongside a majority flip. Nothing
 * else reaches that band, and a single trade never can.
 *
 * TWO PATHS, ONE SCALE. Where a score comes from depends on who writes the row:
 *
 *   EMITTED  system events (cohorts, transitions) are authored by our own
 *            emitters, which know exactly why they fired — they persist their
 *            score into the payload at emission.
 *   DERIVED  chain trades are written by the indexer, which knows nothing about
 *            meaning. Their score is computed at read time by the scorer that
 *            ALREADY runs on them for materiality filtering (scoreFeedEvent) —
 *            the number existed and was being discarded. No migration, no
 *            backfill, no second scoring system.
 *
 * WHAT NEVER BELONGS HERE: anything viewer-relative. Twin, Tribe, Rival and
 * match scores are one reader's view and are applied as a bounded read-time
 * boost (src/domain/viewer-relationship). Universal significance belongs to the
 * event; relevance belongs to the reader.
 *
 * EXPLAINABILITY. Every scorer returns its reasons. They need not be persisted,
 * but a score no one can account for is a magic constant, and this module exists
 * to stop those spreading across emitters.
 *
 * ZERO IO, pure, fully testable.
 */
import { scoreFeedEvent, type FeedCandidate } from "@/domain/feed-event";

export interface Significance {
  /** 0..1 on the shared scale. */
  score: number;
  /** Why. For tests and diagnostics; persisting is optional. */
  reasons: string[];
}

export const SIGNIFICANCE = {
  /** Used ONLY for legacy or malformed rows. Never the normal path. */
  fallback: 0.5,
  bands: {
    low: 0.24,
    contextual: 0.49,
    notable: 0.69,
    high: 0.84,
  },
} as const;

export type SignificanceBand = "low" | "contextual" | "notable" | "high" | "exceptional";

export function bandOf(score: number): SignificanceBand {
  if (score <= SIGNIFICANCE.bands.low) return "low";
  if (score <= SIGNIFICANCE.bands.contextual) return "contextual";
  if (score <= SIGNIFICANCE.bands.notable) return "notable";
  if (score <= SIGNIFICANCE.bands.high) return "high";
  return "exceptional";
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : Number.isFinite(v) ? v : 0);

/**
 * Bounded composition: a floor for the family, plus weighted contributions that
 * can only ever climb toward 1. Additive scoring is how scales quietly break —
 * three mild factors should not sum to "exceptional".
 */
export function compose(
  base: number,
  parts: Array<{ weight: number; value: number; why?: string }>,
): Significance {
  let score = clamp01(base);
  const reasons: string[] = [];
  for (const p of parts) {
    const v = clamp01(p.value);
    if (v <= 0) continue;
    // Each part closes some of the remaining distance to 1 — never overshoots.
    score += (1 - score) * clamp01(p.weight) * v;
    if (p.why) reasons.push(p.why);
  }
  return { score: Number(clamp01(score).toFixed(4)), reasons };
}

// ── LIVE ACTIONS ─────────────────────────────────────────────────────────────

/**
 * A trade's importance, from the scorer that already judges it. `scoreFeedEvent`
 * returns 0–100 with a tier and is already run on every row for the materiality
 * gate; this maps it onto the shared scale rather than inventing a second one.
 *
 * The tier does the coarse work (it already knows a structural event outranks a
 * big number), and the score positions the row inside its tier's band.
 */
export function scoreLiveAction(
  c: FeedCandidate,
  extra: { daysHeld?: number | null; fullExit?: boolean; rank?: number | null } = {},
): Significance {
  const { score, tier } = scoreFeedEvent(c);
  // Tier floors keep families comparable: a Tier-1 trade is at least "high".
  const floor = tier === 1 ? 0.7 : tier === 2 ? 0.5 : tier === 3 ? 0.28 : 0.1;
  const within = clamp01(score / 100);

  const parts: Array<{ weight: number; value: number; why?: string }> = [
    { weight: 0.35, value: within, why: `feed score ${score}/100` },
  ];

  // Behaviour that a raw amount cannot express. These are the cases the brief
  // calls out: a switch, or a long belief ending, outranks an ordinary buy.
  if (c.kind === "side_shift") {
    parts.push({ weight: 0.5, value: 1, why: "changed sides" });
  }
  const days = extra.daysHeld ?? 0;
  if (extra.fullExit && days > 0) {
    // A 90-day belief ending is the top of this ramp; a 3-day one barely moves it.
    parts.push({
      weight: 0.45,
      value: clamp01(days / 90),
      why: `full exit after ${Math.round(days)}d`,
    });
  } else if (extra.fullExit) {
    parts.push({ weight: 0.15, value: 1, why: "full exit" });
  }
  if (extra.rank === 1) parts.push({ weight: 0.4, value: 1, why: "largest position on the side" });

  const out = compose(floor, parts);
  // ONE PERSON'S ACTION IS NEVER "EXCEPTIONAL". That band is reserved for a
  // market changing its own answer or a reader meeting their Twin. A dramatic
  // individual TRADE — a switch, the largest believer walking — belongs at the
  // top of "high", so a structural story always outranks it. Without this a
  // two-wallet switch tipped over 0.85 and sat level with a majority flip, which
  // is not what either of them means.
  return out.score > SIGNIFICANCE.bands.high
    ? { score: SIGNIFICANCE.bands.high, reasons: [...out.reasons, "capped: individual action"] }
    : out;
}

// ── MARKET TRANSITIONS ───────────────────────────────────────────────────────

/**
 * A market-state story. The engine's own tier already encodes how much
 * interpretation the state carries; share-of-market and persistence refine it.
 */
export function scoreMarketTransition(input: {
  type: string;
  tier: 1 | 2 | 3;
  /** Fraction of the market's believers involved, when known. */
  share?: number | null;
  /** How many observations the state survived before being emitted. */
  observations?: number | null;
}): Significance {
  // A flip is the market changing its own answer — the top of the scale.
  const structural = input.type === "majority_flipped";
  const floor = structural ? 0.85 : input.tier === 1 ? 0.66 : input.tier === 2 ? 0.5 : 0.3;

  const parts: Array<{ weight: number; value: number; why?: string }> = [];
  if (structural) parts.push({ weight: 0.4, value: 1, why: "the market's answer changed" });
  if (input.share != null && input.share > 0)
    parts.push({
      weight: 0.3,
      value: clamp01(input.share),
      why: `affects ${Math.round(input.share * 100)}% of the market`,
    });
  if (input.observations != null && input.observations > 2)
    parts.push({
      weight: 0.15,
      value: clamp01((input.observations - 2) / 4),
      why: `held for ${input.observations} readings`,
    });

  return compose(floor, parts);
}

// ── MILESTONES ───────────────────────────────────────────────────────────────

/**
 * A round number crossed. Rarity is nearly everything: 10 believers is a fact,
 * 1,000 is an event. Routine round numbers must not read as important.
 */
export function scoreMilestone(input: {
  threshold: number;
  /** People represented by the milestone, when it is a group. */
  people?: number | null;
}): Significance {
  const t = Math.max(1, input.threshold);
  // log10 keeps the ladder honest: each 10× is one step, not one point.
  const rarity = clamp01((Math.log10(t) - 1) / 3); // 10 → 0, 10k → 1
  const parts: Array<{ weight: number; value: number; why?: string }> = [
    { weight: 0.55, value: rarity, why: `crossed ${t.toLocaleString("en-US")}` },
  ];
  if (input.people && input.people > 1)
    parts.push({ weight: 0.2, value: clamp01(input.people / 25), why: `${input.people} people` });
  return compose(0.3, parts);
}

// ── DISCOVERY MOMENTS ────────────────────────────────────────────────────────

/**
 * Meeting someone. A discovery moment is a VIEWER-SCOPED event: its audience is
 * exactly one person, where a market transition's audience is everyone. That
 * does not bend the scale — significance asks "how important is this to the
 * people it is for?", and finding your Twin is the most important thing that can
 * happen to the one person it is for.
 *
 * The rarity of the KIND does nearly all the work (src/domain/discovery-moment
 * owns that ladder); evidence only refines it, because a relationship named on
 * thin history is a weaker claim however rare its label.
 */
export function scoreDiscoveryMoment(input: {
  /** 0..1 from the moment ladder — a Twin appearing is 1, a Tribe arrival 0.5. */
  rarity: number;
  /** Shared convictions behind the relationship. */
  sharedConvictions?: number | null;
  /** How many people the moment introduces. */
  people?: number | null;
}): Significance {
  const rarity = clamp01(input.rarity);
  // Calibrated so a Twin or an Opp appearing reaches "exceptional" and leads the
  // feed, while an ordinary new Tribe member lands in "high" and has to earn its
  // place in the sequence like everything else. Discovery is the point; a
  // discovery every day would stop being one.
  const floor = 0.5 + 0.38 * rarity;
  const parts: Array<{ weight: number; value: number; why?: string }> = [
    { weight: 0.25, value: rarity, why: `discovery rarity ${rarity.toFixed(2)}` },
  ];
  if (input.sharedConvictions != null && input.sharedConvictions > 0)
    parts.push({
      weight: 0.2,
      value: clamp01(input.sharedConvictions / 25),
      why: `${input.sharedConvictions} shared convictions`,
    });
  if (input.people != null && input.people > 1)
    parts.push({ weight: 0.1, value: clamp01(input.people / 5), why: `${input.people} people` });
  return compose(floor, parts);
}

// ── COVERAGE REGISTRY ────────────────────────────────────────────────────────

/**
 * How every feed-eligible kind gets its score. This is the guard against the
 * exact failure this module was written to fix: a new LIVE_KIND shipping with no
 * scorer and silently falling back to 0.5 forever. A kind must be listed here,
 * and a test asserts the registry and LIVE_KINDS agree.
 */
export const SIGNIFICANCE_COVERAGE = {
  /** Chain trades: derived at read time from the scorer already run on them. */
  trade: "derived",
  trade_burst: "derived",
  large_trade: "derived",
  round_trip: "derived",
  position_changed_side: "derived",
  side_shift: "derived",
  market_created: "derived",
  /** Our own emitters: persisted into the payload at emission. */
  conviction_cohort: "emitted",
  market_transition: "emitted",
  believer_milestone: "emitted",
  tribe_doubled: "emitted",
  /**
   * Viewer-scoped, synthesized at read time from the DNA cache. Never written to
   * `events` — it exists for one reader — so it is scored where it is built.
   */
  discovery_moment: "derived",
} as const satisfies Record<string, "derived" | "emitted">;

export type ScoredKind = keyof typeof SIGNIFICANCE_COVERAGE;

export function isCovered(kind: string): kind is ScoredKind {
  return kind in SIGNIFICANCE_COVERAGE;
}

/**
 * Telemetry. Answers "what share of the live feed is still guessing?" — the
 * question that makes a silent regression visible instead of merely possible.
 */
export function fallbackRate(rows: Array<{ kind: string; significance?: number | null }>): {
  total: number;
  fallback: number;
  rate: number;
  kinds: string[];
} {
  const missing = rows.filter((r) => r.significance == null || !isCovered(r.kind));
  const kinds = [...new Set(missing.map((r) => r.kind))].sort();
  return {
    total: rows.length,
    fallback: missing.length,
    rate: rows.length === 0 ? 0 : Number((missing.length / rows.length).toFixed(4)),
    kinds,
  };
}
