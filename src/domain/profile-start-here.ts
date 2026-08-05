/**
 * START HERE — the one market that best explains this person to this visitor.
 *
 * THE PROBLEM IT SOLVES. The profile used to offer four defining convictions and
 * then four more markets to explore: eight doors of equal size. A visitor given
 * eight equal choices makes none of them, so the page ended in reading rather
 * than in opening something. One recommendation, stated with its reason, is the
 * difference between a page you look at and a page you leave through.
 *
 * IT IS NOT "THEIR BIGGEST POSITION". The largest number is the easiest thing to
 * rank by and the least likely to teach anybody anything — most visitors would
 * learn more from the market where the two of them reached opposite conclusions
 * about a topic they usually agree on. So this ranks by how much OPENING THE
 * MARKET WOULD EXPLAIN, and the size of the position is one input among several.
 *
 * IT CONSIDERS BOTH PEOPLE. The same profile recommends different markets to
 * different visitors, and the same market for different reasons. A signed-out
 * reader gets the person's own strongest conviction, explained in the person's
 * terms — never a relationship sentence with nobody on the other side of it.
 *
 * EVERY RESULT EXPLAINS ITSELF. A candidate that cannot say why it is the one is
 * not eligible to be the one, which is why this returns null rather than
 * defaulting to the first row. An empty section is honest; "Recommended" is not.
 *
 * ZERO IO, pure, fully testable.
 */

export type Side = "YES" | "NO";

/**
 * One market this person holds, with everything known about how it sits between
 * the two people. Assembled by the caller from the profile's existing data — no
 * signal here needs a query the page does not already run.
 */
export interface StartCandidate {
  marketId: number;
  title: string;
  personSide: Side;
  /** Their committed USD, or null when unpriced. */
  valueUsd: number | null;
  daysHeld: number;
  tenureIsFloor: boolean;
  /** How much of the room disagrees with them, 0..100, or null when unknowable. */
  againstPct: number | null;
  /** Directional believers here. Distinguishes a real room from three people. */
  participants: number;
  /** The viewer's side, or null when they have never taken one here. */
  viewerSide: Side | null;
  /** This market's topic, when known. */
  category: string | null;
  /** True when the two of them usually land the same way on this topic. */
  topicUsuallyAligned: boolean;
  /** Their single largest / longest position, precomputed by the caller. */
  isLargest: boolean;
  isLongest: boolean;
}

export const START = {
  /**
   * A market needs a real room before "you two disagree" is interesting rather
   * than arithmetic. Two people holding opposite sides of an empty market is a
   * coincidence, not a debate worth opening.
   */
  minParticipants: 4,
  /** Below this the crowd cannot make anyone contrarian. */
  contrarianPct: 70,
  /** A hold shorter than this is not yet an endurance story. */
  minDaysForLongest: 14,
} as const;

export interface StartHere {
  marketId: number;
  title: string;
  /** Why this one, in terms of both people. Never generic, never empty. */
  why: string;
}

/**
 * WHAT EACH FACT IS WORTH.
 *
 * Read top to bottom, this is the product's claim about what teaches a visitor
 * the most: a surprising disagreement, then a conviction they have not met, then
 * the scale of the commitment. Size is deliberately near the bottom.
 */
const WEIGHT = {
  /** They disagree, on a topic these two usually agree about. The rarest, best. */
  surprisingDisagreement: 1.0,
  /** They disagree at all, in a market with a real room. */
  disagreement: 0.62,
  /**
   * The viewer has never taken a side here — there is something new behind it.
   *
   * Set ABOVE `largest + agreement` on purpose. A market you have both already
   * backed the same way teaches a visitor nothing new, however large the
   * position, so being their biggest holding must not be able to rescue it past
   * a market the visitor has never opened.
   */
  unexplored: 0.55,
  /** It is the person's defining position by size or by tenure. */
  largest: 0.42,
  longest: 0.38,
  /** They stood against a lopsided room. */
  contrarian: 0.34,
  /** The topic is one these two keep meeting on. */
  sharedTopic: 0.22,
  /** They already agree here — real, but the least new information available. */
  agreement: 0.08,
} as const;

const n = (v: number | null | undefined): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;

const isContrarian = (c: StartCandidate): boolean =>
  c.againstPct != null &&
  c.participants >= START.minParticipants &&
  c.againstPct >= START.contrarianPct;

/** A real disagreement needs a real room behind it. */
const disagrees = (c: StartCandidate): boolean =>
  c.viewerSide != null && c.viewerSide !== c.personSide && c.participants >= START.minParticipants;

function score(c: StartCandidate): number {
  let s = 0;
  if (disagrees(c)) {
    s += c.topicUsuallyAligned ? WEIGHT.surprisingDisagreement : WEIGHT.disagreement;
  } else if (c.viewerSide == null) {
    s += WEIGHT.unexplored;
  } else {
    s += WEIGHT.agreement;
  }
  if (c.isLargest) s += WEIGHT.largest;
  if (c.isLongest && c.daysHeld >= START.minDaysForLongest) s += WEIGHT.longest;
  if (isContrarian(c)) s += WEIGHT.contrarian;
  if (c.topicUsuallyAligned && c.category) s += WEIGHT.sharedTopic;
  return s;
}

/** "642 days" / "512+ days" — the floor marker is never dropped. */
function tenure(days: number, floor: boolean): string {
  const d = Math.max(0, Math.floor(days));
  return `${d.toLocaleString("en-US")}${floor ? "+" : ""} day${d === 1 ? "" : "s"}`;
}

/**
 * The sentence. Two clauses at most: what makes the market matter TO THEM, and
 * what makes it matter BETWEEN YOU. A third clause turns a reason into a pitch.
 *
 * Ordered so the clause a reader could not have guessed comes first.
 */
function explain(c: StartCandidate, name: string, hasViewer: boolean): string | null {
  const them: string[] = [];
  if (c.isLargest && n(c.valueUsd) > 0) them.push("their largest current position");
  else if (c.isLongest && c.daysHeld >= START.minDaysForLongest)
    them.push(`the conviction they have held longest, ${tenure(c.daysHeld, c.tenureIsFloor)}`);
  else if (isContrarian(c))
    them.push(`a market where they back ${c.personSide} and ${c.againstPct}% of the room does not`);

  const between: string[] = [];
  // NO VIEWER, NO RELATIONSHIP CLAUSE. "You have not taken a side here yet" is
  // true of a signed-in visitor who skipped this market and misleading for a
  // signed-out one who has no wallet at all — the engine cannot tell those
  // apart from `viewerSide` alone, so the caller says which it is.
  if (!hasViewer) {
    /* nothing between two people when there is only one */
  } else if (disagrees(c)) {
    between.push(
      c.topicUsuallyAligned && c.category
        ? `you two usually agree on ${c.category}, and here you do not — you back ${c.viewerSide}, they back ${c.personSide}`
        : `you back ${c.viewerSide} and they back ${c.personSide}`,
    );
  } else if (c.viewerSide == null) {
    between.push(
      c.topicUsuallyAligned && c.category
        ? `${c.category} is a topic you keep meeting on, and you have not taken a side here`
        : "you have not taken a side here yet",
    );
  }

  // Nothing true and specific to say — so this candidate does not get to be the
  // recommendation, however well it scored.
  if (them.length === 0 && between.length === 0) return null;

  const parts = [...them, ...between];
  const sentence = parts.join(", and ");
  return `${name} — ${sentence[0].toUpperCase()}${sentence.slice(1)}.`;
}

/**
 * Every candidate that can explain itself, most revealing first.
 *
 * ONE ENGINE, not two. The profile needs a front door AND a short list of
 * further markets to explore, and running those off separate rankings would let
 * the page recommend a market for one reason in one section and a different
 * reason three sections below. The front door is simply the first row of this.
 *
 * Ties break toward the market with the bigger room: between two equally
 * revealing markets, the busier one has more for a visitor to walk into.
 */
export function rankStartCandidates(
  candidates: readonly StartCandidate[],
  opts: { personName?: string; hasViewer?: boolean } = {},
): StartHere[] {
  const name = opts.personName?.trim() || "They";
  // Default true: a candidate list carrying a `viewerSide` came from somewhere,
  // and silently dropping the relationship clause would be the worse failure.
  const hasViewer = opts.hasViewer ?? true;
  return [...candidates]
    .map((c) => ({ c, s: score(c) }))
    .sort((a, b) => b.s - a.s || b.c.participants - a.c.participants || a.c.marketId - b.c.marketId)
    .map(({ c }) => {
      const why = explain(c, name, hasViewer);
      return why ? { marketId: c.marketId, title: c.title, why } : null;
    })
    .filter((r): r is StartHere => r !== null);
}

/** The one market to open, or null when nothing can explain itself. */
export function startHere(
  candidates: readonly StartCandidate[],
  opts: { personName?: string; hasViewer?: boolean } = {},
): StartHere | null {
  return rankStartCandidates(candidates, opts)[0] ?? null;
}
