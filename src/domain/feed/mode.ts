/**
 * FEED MODES — three social perspectives on one ranked list.
 *
 * This replaces the opportunity LENS picker, which offered Hot / Early / Hidden
 * / Contested / Conviction / New. Measured against production the taxonomy did
 * not survive contact: 96.9% of markets carried no type at all, and `hot` was
 * arithmetically impossible at the platform's trade rate — the control mostly
 * offered ways to empty the feed. Worse, it asked the reader to classify
 * markets, which is the engine's job.
 *
 * A mode asks a different question. Not "what kind of market is this" but
 * "whose view of the platform am I taking":
 *
 *   FOR YOU  the blend — your behaviour, your people, and what is actually
 *            happening. The default, and the only one that works on day one.
 *   TRIBE    markets where people you align with have taken a side.
 *            "What are people I trust backing?"
 *   RIVALS   markets where people who consistently disagree with you have.
 *            "What are people who challenge me backing?"
 *
 * TWO THINGS THIS MODULE REFUSES TO DO.
 *
 * 1. RANK RIVALS BY HOW MUCH THEY DISAGREE. That is ranking for conflict, and
 *    it produces an argument generator. Rivals rank by SHARED ATTENTION WITH
 *    OPPOSITE CONCLUSION — how many markets you have both had beliefs in and
 *    landed on opposite sides of. A mild opponent who shows up in eight of your
 *    markets is more useful than an extreme one you have met once, and the
 *    extreme one is exactly who a magnitude ranking would surface first.
 *
 * 2. OFFER A MODE THAT WOULD BE EMPTY. Conviction DNA needs shared beliefs
 *    before it will call anyone aligned or opposed, so most viewers have no
 *    qualified relationships and a Tribe tab would read "nothing here" on their
 *    first visit — teaching them the relationship model is decoration. A mode is
 *    offered only once the evidence exists to fill it (`availableModes`).
 *
 * ZERO IO, pure, fully testable.
 */
import type { EvidenceLevel } from "@/domain/dna/config";

export type FeedMode = "for_you" | "tribe" | "rivals";

export const FEED_MODES = {
  for_you: { label: "For You", question: "What is worth your attention right now?" },
  tribe: { label: "Tribe", question: "What are people you align with backing?" },
  rivals: { label: "Rivals", question: "What are people who challenge you backing?" },
} as const satisfies Record<FeedMode, { label: string; question: string }>;

export const MODE_TUNING = {
  /**
   * Qualified relationships needed before a mode is offered at all.
   *
   * Two, not one. A single relationship produces a tab holding whatever that
   * one person happens to be in today, which reads as a bug rather than a
   * perspective — and DNA's own first inference is its least reliable.
   */
  minPeople: 2,
  /**
   * The weakest evidence that counts toward that. "early" is 5+ shared beliefs
   * (see `evidenceLevelFor`): enough that the label is a finding rather than a
   * coincidence, without waiting for the 25 that "established" wants.
   */
  minEvidence: "early" as EvidenceLevel,
} as const;

const EVIDENCE_ORDER: Record<EvidenceLevel, number> = {
  insufficient: 0,
  early: 1,
  growing: 2,
  established: 3,
};

/** Does this relationship carry enough evidence to seat a mode? */
export function qualifies(evidence: EvidenceLevel): boolean {
  return EVIDENCE_ORDER[evidence] >= EVIDENCE_ORDER[MODE_TUNING.minEvidence];
}

/** What the viewer's network can support, in display order. */
export function availableModes(network: {
  aligned: readonly { evidenceLevel: EvidenceLevel }[];
  opposed: readonly { evidenceLevel: EvidenceLevel }[];
}): FeedMode[] {
  const enough = (people: readonly { evidenceLevel: EvidenceLevel }[]) =>
    people.filter((p) => qualifies(p.evidenceLevel)).length >= MODE_TUNING.minPeople;
  // For You is always offered: it is the only mode that works with no network,
  // and a picker with nothing in it is worse than no picker.
  const out: FeedMode[] = ["for_you"];
  if (enough(network.aligned)) out.push("tribe");
  if (enough(network.opposed)) out.push("rivals");
  return out;
}

/** One market, as a mode needs to judge it. */
export interface ModeCandidate {
  onchainId: number;
  /** The composite score the ranker already produced, 0..100. */
  score: number;
  /** People here the viewer aligns with / is opposed to. */
  tribeCount: number;
  oppCount: number;
  /**
   * Shared attention with the people here: how many past markets the viewer and
   * they BOTH held beliefs in, summed. For Tribe that is same-side agreement;
   * for Rivals it is opposite-side disagreement — the honest measure of a
   * relationship's depth in each direction.
   */
  tribeOverlap: number;
  oppOverlap: number;
  /** Hours since the newest relevant activity, or null when unknown. */
  recencyHours: number | null;
}

/** Markets a mode will show at all. For You shows everything it is given. */
export function admits(mode: FeedMode, c: ModeCandidate): boolean {
  if (mode === "tribe") return c.tribeCount > 0;
  if (mode === "rivals") return c.oppCount > 0;
  return true;
}

/** Recency as a 0..1 weight — today matters, last month barely does. */
function fresh(hours: number | null): number {
  if (hours == null || !Number.isFinite(hours) || hours < 0) return 0;
  if (hours <= 24) return 1;
  if (hours >= 24 * 14) return 0;
  return 1 - (hours - 24) / (24 * 13);
}

/** Diminishing returns on a count: the fourth person adds less than the first. */
const soft = (n: number, cap: number): number =>
  n > 0 && cap > 0 ? Math.log1p(Math.min(n, cap)) / Math.log1p(cap) : 0;

/**
 * A mode's ordering key — higher is earlier. The composite score is always a
 * term, never the only one: a mode that ignored it would happily lead with a
 * dead market that happens to contain one of your people.
 */
export function modeRank(mode: FeedMode, c: ModeCandidate): number {
  const base = Math.max(0, c.score) / 100;
  if (mode === "tribe") {
    return (
      0.4 * soft(c.tribeCount, 4) +
      0.25 * soft(c.tribeOverlap, 40) +
      0.2 * fresh(c.recencyHours) +
      0.15 * base
    );
  }
  if (mode === "rivals") {
    // SHARED ATTENTION leads, not disagreement magnitude. `oppOverlap` counts
    // the markets you have both had beliefs in and landed opposite on — depth
    // of a real disagreement, rather than the loudness of one instance.
    return (
      0.4 * soft(c.oppOverlap, 40) +
      0.25 * soft(c.oppCount, 4) +
      0.2 * fresh(c.recencyHours) +
      0.15 * base
    );
  }
  return base;
}

/** Order a mode's markets. Stable: equal keys keep the ranker's own sequence. */
export function orderForMode<T extends ModeCandidate>(mode: FeedMode, candidates: T[]): T[] {
  if (mode === "for_you") return candidates;
  return candidates
    .filter((c) => admits(mode, c))
    .map((c, i) => ({ c, i, k: modeRank(mode, c) }))
    .sort((a, b) => b.k - a.k || a.i - b.i)
    .map((x) => x.c);
}

/** Read a mode off a URL/query value, defaulting rather than throwing. */
export function toFeedMode(v: unknown): FeedMode {
  return v === "tribe" || v === "rivals" ? v : "for_you";
}
