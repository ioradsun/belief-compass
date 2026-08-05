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

/**
 * CALIBRATED AGAINST PRODUCTION, not against an imagined platform.
 *
 * Measured over all 2,770 markets: 789 have any participant at all (28.5%), and
 * among those the room sizes are p50 1 · p75 2 · p90 4 · p95 5 · MAX 37. Total
 * capital per market is p50 $0.93 · p90 $7.68 · p95 $22.90 · max $503. Only 204
 * markets have both sides held, which is the entire population in which a
 * disagreement is even possible.
 *
 * The first draft of these numbers assumed a much bigger platform — a 12-person
 * floor for a "real room", saturation at 40 participants and $500 — and against
 * the real distribution that did not merely over-correct, it NULLIFIED what it
 * was tuning. A 12-participant floor reaches 0.2% of markets, so the surprising
 * disagreement weight was unreachable; saturation at 40 sat above the observed
 * maximum, so the significance term was flat near zero for everything. The
 * safeguard would have quietly switched the relationship signal off, which is
 * the same failure as a lens that never matches anything.
 *
 * Every threshold below is now a percentile of markets that have participants.
 * THEY MUST BE REVISITED as the platform grows — a fixed number tuned to a
 * young market becomes wrong in the other direction later.
 */
export const START = {
  /**
   * A market needs a room before "you two disagree" is interesting rather than
   * arithmetic. A shared market already contains both of them, so this really
   * says: at least one other person is here too. ≈p85 of live markets.
   */
  minParticipants: 3,
  /**
   * And one of the busier rooms on the platform before a disagreement gets the
   * TOP weight. ≈p95 of live markets — genuinely rare, still reachable.
   *
   * The failure this prevents was checkable arithmetic: a surprising clash in a
   * tiny market outscored a large, long-held, unexplored conviction, so the
   * front door became "where do we disagree most" rather than "what best
   * explains this person".
   */
  minParticipantsForSurprise: 5,
  /** Below this the crowd cannot make anyone contrarian. */
  contrarianPct: 70,
  /** A hold shorter than this is not yet an endurance story. */
  minDaysForLongest: 14,
  /**
   * Where the significance term saturates. Set inside the OBSERVED range, not
   * above it — saturating at 40 when the busiest market has 37 people made the
   * term flat near zero and therefore decorative.
   */
  roomSaturatesAt: 8,
  /** Committed USD at saturation. ≈p95 of total market capital. */
  stakeSaturatesAt: 20,
  /** Days at which the tenure bonus saturates. A year is a long conviction. */
  tenureSaturatesAt: 365,
  /**
   * Disagreements allowed in the whole ranked list.
   *
   * A profile that answers every question with "here is somewhere you two
   * disagree" has stopped introducing a person and started picking fights. The
   * front door may be one; the further reading gets at most one more.
   */
  maxDisagreements: 2,
} as const;

export interface StartHere {
  marketId: number;
  title: string;
  /** Why this one, in terms of both people. Never generic, never empty. */
  why: string;
  /**
   * What kind of recommendation this is. Not rendered — it exists so a reviewer
   * can classify the output at a glance, and so a caller could one day treat
   * "challenging" differently from "discovering". There is no `weak` member on
   * purpose: a weak candidate is not returned at all.
   */
  kind: StartKind;
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
  /**
   * How much LONGER-THAN-USUAL a hold adds on top, saturating around a year.
   *
   * Without it `largest` and `longest` sat close enough that capital decided
   * between them, and a long-tenured account opened on an $8 position instead
   * of a 512-day conviction — on a platform whose 95th-percentile market holds
   * $23 in total. Duration is the scarcer signal here, so it scales.
   */
  tenureDepth: 0.3,
  /** They stood against a lopsided room. */
  contrarian: 0.34,
  /** The topic is one these two keep meeting on. */
  sharedTopic: 0.22,
  /** They already agree here — real, but the least new information available. */
  agreement: 0.08,
  /**
   * How much the MARKET ITSELF matters — its room and their commitment to it.
   *
   * Large enough to decide between two otherwise comparable candidates, which
   * is the point: without it a trivial market could win on relationship alone,
   * and "what best explains this person" would quietly become "where do we
   * disagree". Never large enough to make this a size ranking either — a fully
   * saturated significance is worth less than a surprising disagreement.
   */
  significance: 0.5,
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

/**
 * Log-saturating, CLAMPED to 0..1: the first few of anything count for most of
 * the weight, and nothing past saturation counts for more than saturation.
 *
 * The clamp is not cosmetic. Unclamped, `soft(37, 8)` returns 1.66, so a single
 * busy market could contribute more than a full term was ever meant to be worth
 * and quietly outrank things it should not.
 */
const soft = (v: number, at: number): number =>
  Math.min(1, Math.log1p(Math.max(0, v)) / Math.log1p(at));

/**
 * HOW MUCH THIS MARKET MATTERS, 0..1 — the room it drew and what they put into
 * it, weighted equally.
 *
 * This is the safeguard against a trivial market winning on relationship alone.
 * A four-person market where nobody committed anything is a low-information
 * market whatever the two of you concluded in it, and a profile that opens with
 * one has spent its single best slot on a coincidence.
 */
function significance(c: StartCandidate): number {
  const room = soft(c.participants, START.roomSaturatesAt);
  const stake = soft(n(c.valueUsd), START.stakeSaturatesAt);
  return Math.min(1, 0.5 * room + 0.5 * stake);
}

function score(c: StartCandidate): number {
  let s = WEIGHT.significance * significance(c);
  if (disagrees(c)) {
    // The TOP weight needs a real room, not merely a non-empty one. Below that
    // bar a surprising clash is still a disagreement — just not the best thing
    // the page has to offer.
    const surprising = c.topicUsuallyAligned && c.participants >= START.minParticipantsForSurprise;
    s += surprising ? WEIGHT.surprisingDisagreement : WEIGHT.disagreement;
  } else if (c.viewerSide == null) {
    s += WEIGHT.unexplored;
  } else {
    s += WEIGHT.agreement;
  }
  if (c.isLargest) s += WEIGHT.largest;
  if (c.isLongest && c.daysHeld >= START.minDaysForLongest) {
    // Depth is measured BEYOND the floor, not from zero. A 20-day hold has only
    // just qualified as "longest held"; counting all 20 days made it worth
    // almost as much as a 500-day conviction.
    const beyond = Math.max(0, c.daysHeld - START.minDaysForLongest);
    s += WEIGHT.longest + WEIGHT.tenureDepth * soft(beyond, START.tenureSaturatesAt);
  }
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
 * THE SENTENCE — at least two signals, or nothing.
 *
 * ONE SIGNAL PRODUCES METADATA. "You have not taken a side here yet" is a
 * database fact about a stranger. "Their largest current position" is a label.
 * Neither one tells a reader why opening this market would teach them anything
 * about this person, and a section built out of them reads like a query result.
 *
 * TWO SIGNALS PRODUCE A STORY, because the second one supplies the reason the
 * first one matters:
 *
 *   "You usually agree on culture, and this is the conviction they have held
 *    longest — you have never taken a side here."
 *
 * That is the relationship, the defining behaviour and the discovery gap in one
 * breath, and it is the shape this composer aims at whenever the data allows.
 * Below two signals it returns null and the page shows no Start Here at all,
 * which is the honest outcome: an empty slot costs a visitor nothing, and a
 * generic recommendation costs them their trust in every other one.
 *
 * A signed-out reader has no relationship signals available, so their two come
 * from the person alone — largest AND long-held, or a contrarian stand with the
 * room behind it.
 */

/** What kind of thing this recommendation is, for the caller and for review. */
export type StartKind = "challenging" | "connecting" | "defining" | "discovering";

/** Sentence-cased, with the trailing period. Clauses arrive pre-joined. */
const sentence = (name: string, body: string): string =>
  `${name} — ${body[0].toUpperCase()}${body.slice(1)}.`;

function explain(
  c: StartCandidate,
  name: string,
  hasViewer: boolean,
): { why: string; kind: StartKind } | null {
  // ── the signals, each either present with its phrase or absent ──────────────
  const largest = c.isLargest && n(c.valueUsd) > 0 ? "their largest current position" : null;
  const held = tenure(c.daysHeld, c.tenureIsFloor);
  const longEnough = c.daysHeld >= START.minDaysForLongest;
  // `longest` names a superlative AND its evidence, so it is worth two signals
  // on its own — "the conviction they have held longest, 512+ days" is already
  // a story rather than a label.
  const longest =
    c.isLongest && longEnough ? `the conviction they have held longest, ${held}` : null;
  const contrarian = isContrarian(c)
    ? `a market where they back ${c.personSide} while ${c.againstPct}% of the room does not`
    : null;
  // Duration as a SUPPORTING fact on a position that is not their longest. This
  // is what gives a signed-out reader a second signal without inventing one.
  const heldFor = !longest && longEnough ? `held for ${held}` : null;

  const rel = hasViewer && c.topicUsuallyAligned && c.category ? c.category : null;
  const clash = hasViewer && disagrees(c);
  const gap = hasViewer && c.viewerSide == null;

  const person = [largest, longest, contrarian, heldFor].filter((x): x is string => x !== null);
  const weight =
    (longest ? 1 : 0) + person.length + (rel ? 1 : 0) + (clash ? 1 : 0) + (gap ? 1 : 0);
  if (weight < 2) return null;

  // The strongest thing said about THEM, for the middle of a relationship
  // sentence. `heldFor` never leads — "held for 40 days" is a fact in search of
  // a claim.
  const lead = largest ?? longest ?? contrarian;

  if (clash) {
    // CHALLENGING. The disagreement is the point; a shared topic is what makes
    // it surprising rather than merely true.
    const stand = `you back ${c.viewerSide} and they back ${c.personSide}`;
    const body = rel
      ? `you two usually agree on ${rel}, ${lead ? `but this is ${lead}` : "but here you do not"} — ${stand}`
      : `${lead}, and ${stand}`;
    return { why: sentence(name, body), kind: "challenging" };
  }

  if (rel && gap) {
    // CONNECTING — with a defining fact in the middle, the best sentence this
    // composer can write: the relationship, the behaviour and the gap in one.
    const body = lead
      ? `you two usually agree on ${rel}, and this is ${lead} — you have never taken a side here`
      : `${rel} is a topic you keep meeting on, and you have never taken a side here`;
    return { why: sentence(name, body), kind: "connecting" };
  }

  if (gap && lead) {
    // DISCOVERING. Something specific about them, and a door you have not opened.
    return {
      why: sentence(name, `${lead}, and you have never taken a side here`),
      kind: "discovering",
    };
  }

  if (rel && lead) {
    return {
      why: sentence(name, `you two usually agree on ${rel}, and this is ${lead}`),
      kind: "connecting",
    };
  }

  // DEFINING. No relationship to draw on — so two facts about the person, which
  // is the signed-out case and the one that most needs a second signal.
  if (lead && person.length >= 2) {
    const support = person.find((x) => x !== lead)!;
    return { why: sentence(name, `${lead}, ${support}`), kind: "defining" };
  }
  if (longest) return { why: sentence(name, longest), kind: "defining" };
  return null;
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
  const ordered = [...candidates]
    .map((c) => ({ c, s: score(c) }))
    .sort(
      (a, b) => b.s - a.s || b.c.participants - a.c.participants || a.c.marketId - b.c.marketId,
    );

  // DIVERSITY. A profile that answers every question with "here is somewhere you
  // two disagree" has stopped introducing a person and started picking fights,
  // so past the cap a disagreement yields its slot to the next candidate that
  // reveals something else. Dropped rather than reordered: a demoted clash would
  // reappear lower down saying the same thing.
  const out: StartHere[] = [];
  let clashes = 0;
  for (const { c } of ordered) {
    const clash = hasViewer && disagrees(c);
    if (clash && clashes >= START.maxDisagreements) continue;
    const e = explain(c, name, hasViewer);
    if (!e) continue;
    if (clash) clashes += 1;
    out.push({ marketId: c.marketId, title: c.title, why: e.why, kind: e.kind });
  }
  return out;
}

/** The one market to open, or null when nothing can explain itself. */
export function startHere(
  candidates: readonly StartCandidate[],
  opts: { personName?: string; hasViewer?: boolean } = {},
): StartHere | null {
  return rankStartCandidates(candidates, opts)[0] ?? null;
}
