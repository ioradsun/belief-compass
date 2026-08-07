/**
 * Relationship — the ONE presentation model for "who stands with me, and who
 * takes the other side." Every People surface (the People page, a profile, a
 * market's social proof, the feed, sharing) reads its relationship story from
 * here, so the whole app speaks one language.
 *
 * The non-negotiable distinction this module enforces:
 *
 *   ALIGNMENT  — how consistently two people took the SAME side (the %).
 *   EVIDENCE   — how much shared history backs it (the count).
 *   BREADTH    — how many belief topics were compared.
 *
 * These are never conflated. Four agreements out of four is 100% ALIGNED on thin
 * EVIDENCE — not a Twin, and never shown as a naked "100% match". Low evidence
 * speaks in counts ("3 together · 1 apart"); a mature relationship shows the
 * percentage WITH the evidence behind it. Twin and Opp are earned, not filters.
 *
 * The engine (src/domain/dna/*) already produces the raw signals — agreement,
 * shared count, same/opposite counts, confidence, per-topic domains. This module
 * only shapes them into an honest, human story. ZERO IO, pure, fully tested.
 */
import {
  EARNED_LABELS,
  MATURE_MIN_SHARED,
  RELATIONSHIP_LIST_MIN_SHARED,
  confidenceFor,
  type RelationshipLabel as EngineLabel,
} from "./dna/config";
import { labelFor } from "./dna/classify";

/**
 * The engine's five labels, in the two directions a reader cares about.
 *
 * Twin collapses into tribe and inverse into rival ON PURPOSE: the extreme words
 * are earned badges laid over a direction, not separate places to be. A Twin is
 * a member of your Tribe who cleared a higher bar — putting them in a different
 * group would say they are somewhere else.
 */
function groupFor(label: EngineLabel): RelationshipGroup {
  switch (label) {
    case "twin":
    case "tribe":
      return "tribe";
    case "opp":
    case "inverse":
      return "rival";
    default:
      // `neutral` (met, unplaced) and `insufficient` (met too little to judge)
      // are both "we cannot say" to a reader; only the engine needs them apart.
      return "neutral";
  }
}

/** The two primary groups — plus the states that keep someone OUT of them. */
export type RelationshipGroup = "tribe" | "rival" | "neutral" | "insufficient";
/** Earned top-tier badges. Never a navigation filter. */
export type EarnedLabel = "twin" | "opp" | null;
/** Low evidence → counts; mature → a percentage with its evidence. */
export type EvidenceTier = "low" | "mature";

export interface RelationshipInput {
  /** Conviction-weighted same-side fraction, 0–100 (the engine's `agreement`). */
  agreement: number;
  /** Shared directional convictions — the evidence count. */
  sharedConvictions: number;
  /** Shared markets they took the SAME side on (together). */
  together: number;
  /** Shared markets they took OPPOSITE sides on (apart). */
  apart: number;
  /** Distinct belief topics compared (breadth). */
  topicCount: number;
  /** Strongest topic of agreement, when known ("Culture"). */
  strongestAlignedTopic?: string | null;
  /** Strongest topic of disagreement, when known ("Technology"). */
  strongestOpposedTopic?: string | null;
  /** Optional precomputed confidence; derived from evidence when omitted. */
  confidence?: number;
  /**
   * Shared convictions in CURRENT-EQUIVALENT terms (`DnaScore.evidence`).
   *
   * Defaults to the raw shared count, which is exactly right for a relationship
   * where nothing has been exited — so callers that never saw history keep their
   * behaviour. Where the two differ, THIS is what places the relationship: a
   * reader is told they share twelve convictions, and the model knows that eight
   * of them are memories.
   */
  evidence?: number;
}

export interface RelationshipPresentation {
  group: RelationshipGroup;
  earnedLabel: EarnedLabel;
  tier: EvidenceTier;
  /** Round alignment, 0–100. */
  alignmentPct: number;
  /** 100 − alignment. */
  oppositionPct: number;
  sharedConvictions: number;
  together: number;
  apart: number;
  topicCount: number;
  strongestAlignedTopic: string | null;
  strongestOpposedTopic: string | null;
  confidence: number;
  /** True once in Tribe or Rivals (has enough shared history to place). */
  placed: boolean;
}

const clampPct = (v: number): number =>
  !Number.isFinite(v) ? 0 : Math.max(0, Math.min(100, Math.round(v)));
const count = (v: number): number => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

/**
 * WHAT WAS HERE, and why it had to go.
 *
 *     const NEUTRAL_LOW = 45;
 *     const NEUTRAL_HIGH = 55;
 *
 * A flat 55% put someone in your Tribe, needing exactly ONE shared conviction —
 * `RELATIONSHIP_LIST_MIN_SHARED`. The engine next door says Tribe means 77%
 * agreement over at least eight shared convictions at 0.4 confidence. Both ran.
 * Both were called "the relationship". Measured on production, the engine placed
 * 7 pairs where this placed 1,136, and a third rule in the spectrum placed 219 —
 * all three agreeing on 7.3% of real relationships.
 *
 * So placement is no longer decided here. This module asks `labelFor` — the
 * engine's one rule — and then does what it is actually for: turning a label
 * plus its evidence into something a person can read.
 *
 * The rare words are still EARNED on top (see `earnedFor`), because topic
 * breadth is a requirement no single scalar can express, and that layering was
 * always the intent.
 */

/** Does this relationship clear an earned badge's alignment + evidence + breadth? */
function earnedFor(p: {
  group: RelationshipGroup;
  alignmentPct: number;
  oppositionPct: number;
  sharedConvictions: number;
  topicCount: number;
  confidence: number;
}): EarnedLabel {
  if (p.group === "tribe") {
    const c = EARNED_LABELS.twin;
    if (
      p.alignmentPct >= c.minStrength &&
      p.sharedConvictions >= c.minShared &&
      p.topicCount >= c.minTopics &&
      p.confidence >= c.minConfidence
    )
      return "twin";
  } else if (p.group === "rival") {
    const c = EARNED_LABELS.opp;
    if (
      p.oppositionPct >= c.minStrength &&
      p.sharedConvictions >= c.minShared &&
      p.topicCount >= c.minTopics &&
      p.confidence >= c.minConfidence
    )
      return "opp";
  }
  return null;
}

export function presentRelationship(input: RelationshipInput): RelationshipPresentation {
  const shared = count(input.sharedConvictions);
  const together = count(input.together);
  const apart = count(input.apart);
  const topicCount = count(input.topicCount);
  const alignmentPct = clampPct(input.agreement);
  const oppositionPct = 100 - alignmentPct;
  // Current-equivalent evidence. Falls back to the raw count, which is the same
  // number for a relationship where nothing has been exited.
  const evidence =
    typeof input.evidence === "number" && Number.isFinite(input.evidence)
      ? Math.max(0, input.evidence)
      : shared;
  const confidence =
    typeof input.confidence === "number" && Number.isFinite(input.confidence)
      ? input.confidence
      : confidenceFor(evidence);

  // Placement comes from the ENGINE, not from a second set of thresholds here.
  // `insufficient` still means "no shared history at all" rather than the
  // engine's "under five shared" — a person you have never met in a market is a
  // different thing from one you have met four times, and only the first should
  // be absent from a list rather than merely unplaced in it.
  const group: RelationshipGroup =
    shared < RELATIONSHIP_LIST_MIN_SHARED
      ? "insufficient"
      : groupFor(labelFor({ agreement: alignmentPct, evidence, confidence }));

  // Maturity is an EVIDENCE question — "may this row lead with a percentage?" —
  // so it reads current-equivalent convictions. Twelve shared markets that are
  // all memories should not license the precision that twelve live ones do.
  const tier: EvidenceTier = evidence >= MATURE_MIN_SHARED ? "mature" : "low";
  const earnedLabel = earnedFor({
    group,
    alignmentPct,
    oppositionPct,
    sharedConvictions: evidence,
    topicCount,
    confidence,
  });

  return {
    group,
    earnedLabel,
    tier,
    alignmentPct,
    oppositionPct,
    sharedConvictions: shared,
    together,
    apart,
    topicCount,
    strongestAlignedTopic: input.strongestAlignedTopic?.trim() || null,
    strongestOpposedTopic: input.strongestOpposedTopic?.trim() || null,
    confidence,
    placed: group === "tribe" || group === "rival",
  };
}

/* ── Sorting ──────────────────────────────────────────────────────────────────
 * Tribe: strongest alignment first. Rivals: strongest opposition first. Ties
 * break on evidence, so a well-proven relationship outranks a thin coin-flip. */

const evidenceRank = (p: RelationshipPresentation): number => p.sharedConvictions;

export function sortTribe(a: RelationshipPresentation, b: RelationshipPresentation): number {
  return b.alignmentPct - a.alignmentPct || evidenceRank(b) - evidenceRank(a);
}

export function sortRivals(a: RelationshipPresentation, b: RelationshipPresentation): number {
  return b.oppositionPct - a.oppositionPct || evidenceRank(b) - evidenceRank(a);
}

/* ── Copy (centralized terminology) ───────────────────────────────────────────
 * One place owns every relationship word, so the app never drifts between "Opp"
 * and "Opponent" or shows a percentage without its evidence. */

export const RELATIONSHIP_TERMS = {
  tribe: "Tribe",
  rivals: "Rivals",
  rival: "Rival",
  twin: "Twin",
  opp: "Opp",
} as const;

/** "4 convictions in common" / "1 conviction in common". */
export function formatSharedConvictions(n: number): string {
  const c = count(n);
  return `${c} conviction${c === 1 ? "" : "s"} in common`;
}

/** "19 shared convictions · 4 topics" — the evidence line under a mature %. */
export function formatEvidence(p: RelationshipPresentation): string {
  const c = p.sharedConvictions;
  const t = p.topicCount;
  const shared = `${c} shared conviction${c === 1 ? "" : "s"}`;
  return t > 0 ? `${shared} · ${t} topic${t === 1 ? "" : "s"}` : shared;
}

/**
 * The primary one-line insight. Low evidence speaks in honest counts; a mature
 * relationship leads with the percentage. Never false precision on thin data.
 */
export function relationshipInsight(p: RelationshipPresentation): string {
  if (p.tier === "mature") {
    return p.group === "rival" ? `${p.oppositionPct}% opposite` : `${p.alignmentPct}% aligned`;
  }
  // Low evidence — counts, not a percentage.
  if (p.apart === 0 && p.together > 0) return `Together on all ${p.together}`;
  if (p.together === 0 && p.apart > 0) return `Opposite on all ${p.apart}`;
  if (p.together === 0 && p.apart === 0) return "Split so far";
  return `${p.together} together · ${p.apart} apart`;
}

/** The secondary count line — always shown so a % never stands alone. */
export function relationshipSupport(p: RelationshipPresentation): string {
  if (p.tier === "mature") {
    // Under the %, show the evidence AND the together/apart breakdown lives on
    // its own line (see relationshipBreakdown) — here we surface the evidence.
    return formatEvidence(p);
  }
  return formatSharedConvictions(p.sharedConvictions);
}

export interface RelationshipLabel {
  /** The word to show, e.g. "Twin", "Tribe", "Closest so far". */
  text: string;
  /** earned = a rare badge (Twin/Opp); group = mature Tribe/Rival; provisional = ranking language. */
  kind: "earned" | "group" | "provisional";
  tone: "aligned" | "opposed" | "neutral";
}

/**
 * The relationship label for a card's corner. Twin/Opp when earned; the group
 * word once mature; otherwise honest ranking language ("Closest so far") instead
 * of a manufactured badge. `isTop` lets the caller reserve "so far" for the
 * strongest early relationship in a list.
 */
export function relationshipLabel(
  p: RelationshipPresentation,
  isTop = true,
): RelationshipLabel | null {
  if (p.earnedLabel === "twin") return { text: "Twin", kind: "earned", tone: "aligned" };
  if (p.earnedLabel === "opp") return { text: "Opp", kind: "earned", tone: "opposed" };
  // Never met → nothing to rank, so nothing to say.
  if (p.group === "insufficient") return null;

  // PROVISIONAL LANGUAGE IS FOR THE UNPLACED, and that is now most people.
  //
  // This used to `return null` for anyone the model would not place, which was
  // survivable while placement meant "55% over one shared conviction". Now that
  // placement is the engine's — 77% over eight — the same guard would leave a
  // reader's whole list wordless. "Closest so far" is exactly the honest thing
  // to say about thin evidence: it ranks without claiming, and the "so far" IS
  // the uncertainty. Direction here is ordering language, not a placement.
  if (!p.placed) {
    if (!isTop) return null; // only the strongest gets even ranking language
    const leaning = p.alignmentPct >= 50;
    return {
      text: leaning ? "Closest so far" : "Most opposite so far",
      kind: "provisional",
      tone: leaning ? "aligned" : "opposed",
    };
  }

  const tone = p.group === "rival" ? "opposed" : "aligned";
  if (p.tier === "mature") {
    return { text: p.group === "rival" ? "Rival" : "Tribe", kind: "group", tone };
  }
  if (!isTop) return null; // only the strongest early relationship gets ranking language
  return {
    text: p.group === "rival" ? "Most opposite so far" : "Closest so far",
    kind: "provisional",
    tone,
  };
}

/* ── Shared DNA: a relationship, not a statistic ──────────────────────────────
 *
 * "87% Match" is a number about a person. "Twin · 94% Shared DNA · 41 shared
 * convictions" is a person, with a number that supports them and evidence that
 * validates it. The hierarchy is the product:
 *
 *   LEAD       the relationship        — what they are to you
 *   SCORE      the DNA percentage      — how strongly
 *   EVIDENCE   the shared conviction   — on what basis
 *              count and topic breadth
 *
 * The score is omitted rather than softened when the evidence cannot carry it —
 * a percentage over four shared markets is false precision, and the relationship
 * word plus the honest count says more than a decorated number would. */

/* ── Page-level DNA maturity (factual, not a fake identity %) ─────────────────
 * Uncertainty lives ONCE at the page, never repeated on every row. Stages are
 * qualitative; the raw counts stay visible. */

export type DnaStageLabel = "Taking shape" | "Becoming clearer" | "Well defined";

export interface DnaMaturity {
  stage: DnaStageLabel;
  convictionsMapped: number;
  topicCount: number;
  /** How many more decisions meaningfully sharpen relationships (0 when well-defined). */
  moreToSharpen: number;
  /** One page-level line, shown instead of a per-row "still forming". */
  note: string;
}

/** Decisions that move a viewer between DNA stages. Centralized. */
export const DNA_STAGE = { clearer: 8, defined: 20 } as const;

export function dnaMaturity(convictionsMapped: number, topicCount: number): DnaMaturity {
  const mapped = count(convictionsMapped);
  const topics = count(topicCount);
  let stage: DnaStageLabel;
  let moreToSharpen: number;
  if (mapped >= DNA_STAGE.defined && topics >= 3) {
    stage = "Well defined";
    moreToSharpen = 0;
  } else if (mapped >= DNA_STAGE.clearer) {
    stage = "Becoming clearer";
    moreToSharpen = Math.max(1, DNA_STAGE.defined - mapped);
  } else {
    stage = "Taking shape";
    moreToSharpen = Math.max(1, DNA_STAGE.clearer - mapped);
  }
  const note =
    stage === "Well defined"
      ? "Your people are clear. New convictions keep them fresh."
      : mapped === 0
        ? "Take a side to start finding your people."
        : `Decide on ${moreToSharpen} more market${moreToSharpen === 1 ? "" : "s"} to sharpen your connections.`;
  return { stage, convictionsMapped: mapped, topicCount: topics, moreToSharpen, note };
}
