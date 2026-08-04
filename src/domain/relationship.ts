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
} from "./dna/config";

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

/** The neutral dead-zone around 50% — inside it, nobody is Tribe or Rival. */
const NEUTRAL_LOW = 45;
const NEUTRAL_HIGH = 55;

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
  const confidence =
    typeof input.confidence === "number" && Number.isFinite(input.confidence)
      ? input.confidence
      : confidenceFor(shared);

  // Placement: too little shared history → not in the primary lists (search only).
  let group: RelationshipGroup;
  if (shared < RELATIONSHIP_LIST_MIN_SHARED) {
    group = "insufficient";
  } else if (alignmentPct >= NEUTRAL_HIGH) {
    group = "tribe";
  } else if (alignmentPct <= NEUTRAL_LOW) {
    group = "rival";
  } else {
    group = "neutral";
  }

  const tier: EvidenceTier = shared >= MATURE_MIN_SHARED ? "mature" : "low";
  const earnedLabel = earnedFor({
    group,
    alignmentPct,
    oppositionPct,
    sharedConvictions: shared,
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

/** "Together on 16 · Apart on 3" — the mature card's second detail line. */
export function relationshipBreakdown(p: RelationshipPresentation): string {
  return `Together on ${p.together} · Apart on ${p.apart}`;
}

/** "Strongest connection: Culture" / "Strongest divide: Technology", or null. */
export function relationshipTopicLine(p: RelationshipPresentation): string | null {
  if (p.group === "rival") {
    return p.strongestOpposedTopic ? `Strongest divide: ${p.strongestOpposedTopic}` : null;
  }
  if (p.group === "tribe") {
    const topic = p.strongestAlignedTopic;
    if (!topic) return null;
    return p.tier === "mature" ? `Strongest connection: ${topic}` : `Common ground: ${topic}`;
  }
  return null;
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
  if (!p.placed) return null;
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

export interface SharedDnaDisplay {
  /** The headline: what this person is to the viewer. */
  lead: string;
  kind: "earned" | "group" | "provisional" | "learning";
  tone: "aligned" | "opposed" | "neutral";
  /** The supporting percentage — null whenever the evidence cannot carry one. */
  score: string | null;
  /** What the claim rests on. Always present, even when it is "not much yet". */
  evidence: string;
}

export function sharedDna(p: RelationshipPresentation): SharedDnaDisplay {
  const evidence = p.sharedConvictions === 0 ? "No shared convictions yet" : formatEvidence(p);
  const label = relationshipLabel(p);

  // Not placed yet. "Still learning" is a real state, not a failure — and it is
  // the honest one when two people have barely overlapped.
  if (!label)
    return { lead: "Still learning", kind: "learning", tone: "neutral", score: null, evidence };

  const opposed = label.tone === "opposed";
  return {
    lead: label.text,
    kind: label.kind,
    tone: label.tone,
    score:
      p.tier === "mature"
        ? `${opposed ? p.oppositionPct : p.alignmentPct}% ${opposed ? "Opposite" : "Shared"} DNA`
        : null,
    evidence,
  };
}

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
