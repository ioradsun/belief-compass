/**
 * Feed sequencing — variety, not a sorted list.
 *
 * Ranking says which markets are worth showing. Sequencing decides the ORDER a
 * person experiences them in: a rhythm of personal match → fast-rising → social
 * → fresh → early → exploration, with hard limits on category runs, repeated
 * creators and near-duplicate questions. Re-entry cards (markets the viewer has
 * already acted on) are rare and always labelled.
 *
 * Pure and deterministic: server and client always agree on the same order.
 */
import { SEQUENCE, FEED_ENGINE_VERSION, type ScoreComponent } from "./config";
import type { ScoredMarket, Components } from "./score";
import type { Eligibility, ExclusionReason, Reentry } from "./eligibility";
import { familyOf, type FeedReason } from "./reasons";

export type FeedItemKind = "market" | "market_idea";

/** One fully-evaluated market entering sequencing. */
export interface SequenceCandidate {
  onchainId: number;
  category: string | null;
  creator: string | null;
  clusterId: string | null;
  scored: ScoredMarket;
  eligibility: Eligibility;
  reason: FeedReason | null;
  /** Set only when this is an already-acted market with a material update. */
  reentry: Reentry | null;
  /** Candidate-pool provenance, for diagnostics. Empty when unknown. */
  poolSlices?: string[];
  /**
   * Which way this market is moving — "up", "down", or absent when it is still.
   * Spacing rule only; the card never says it in these words.
   */
  moveDirection?: "up" | "down" | null;
}

export interface FeedIdeaCandidate {
  id: string;
  question: string;
  category: string;
  shortReason: string;
}

/** Why this card is in this slot — the developer answer, shipped with the card. */
export interface FeedDiagnostics {
  eligible: boolean;
  exclusionReason: ExclusionReason | null;
  score: number;
  components: Components;
  driver: ScoreComponent;
  acceleration: number;
  ageHours: number | null;
  clusterId: string | null;
  /** Sequencing moves applied when placing this card. */
  diversityAdjustments: string[];
  slotIntent: ScoreComponent | "reentry" | "fill";
  /**
   * This card came from the RESURFACE tier — the fresh pool was empty when the
   * slot was filled. Not reader-facing: the card reads exactly as it always did,
   * because "we have shown you this before" is not news the way a re-entry
   * label is. It is here so the one question worth asking of a long session —
   * how deep into repeats is this reader — has an answer.
   */
  resurfaced: boolean;
  reasonCode: string | null;
  /**
   * Which candidate-pool slice(s) admitted this market — see @/domain/feed/pool.
   *
   * "Why is this ranked here" and "why is this in the feed at all" are different
   * questions, and for most of this feed's life only the first was answerable.
   * The pool was one ordering, so the second had one answer for every market.
   */
  poolSlices: string[];
  /**
   * Candidates that scored HIGHER than this one and did not get the slot.
   *
   * The third question, and the one nothing could answer: a reader (or an
   * engineer) looking at slot 4 could see its score and its reason but had no
   * way to learn that two better-scoring markets were passed over because the
   * rhythm wanted a different driver, or because placing them would have made
   * three crypto cards in a row. `diversityAdjustments` recorded that SOMETHING
   * was skipped; this records what, and why.
   *
   * Capped — see MAX_DISPLACED. The first few carry the explanation; the rest
   * are payload.
   */
  displaced: DisplacedCandidate[];
}

export interface DisplacedCandidate {
  onchainId: number;
  score: number;
  /** "slot wanted momentum", "category_run", "creator_run", … */
  why: string;
}

export interface FeedMarketItem {
  kind: "market";
  position: number;
  onchainId: number;
  score: number;
  /** The one sentence shown on the card. */
  primaryReason: string | null;
  reasonCode: string | null;
  /** Present ONLY on a re-entry card, and always shown as its own label. */
  reentryLabel: string | null;
  reentryDetail: string | null;
  opportunityType: string | null;
  diagnostics: FeedDiagnostics;
}

export interface FeedIdeaItem {
  kind: "market_idea";
  position: number;
  suggestionId: string;
  question: string;
  category: string;
  shortReason: string;
}

export type OpportunityFeedItem = FeedMarketItem | FeedIdeaItem;

/** The rhythm. Each slot asks for a card whose dominant component matches. */
const RHYTHM: (ScoreComponent | "any")[] = [
  "personal",
  "momentum",
  "social",
  "freshness",
  "quality",
  "any",
  "early",
  "exploration",
];

/**
 * How many passed-over candidates a card carries.
 *
 * Three, because the explanation is in the first few and the rest is payload
 * shipped to every client on every poll. On a full 24-card queue an uncapped
 * list would be quadratic in the pool.
 */
export const MAX_DISPLACED = 3;

interface Placed {
  c: SequenceCandidate;
  adjustments: string[];
  intent: ScoreComponent | "reentry" | "fill";
  displaced: DisplacedCandidate[];
  resurfaced: boolean;
}

/**
 * What placing `c` next would break.
 *
 * TWO CLASSES, and the distinction is load bearing. Category, creator and
 * duplicate-cluster spacing are the original contract, tested as absolutes.
 * Family and direction spacing were added later from measured clustering and are
 * PREFERENCES: on a thin pool every remaining candidate breaks something, and
 * when that happens a preference must yield rather than a guarantee. Adding the
 * two new rules without this split silently broke the category cap, which a test
 * caught.
 *
 * The preferences are also independent of each other. An earlier version relaxed
 * them together, so a pool where every card shared a family — which cannot
 * satisfy the family rule at all — quietly stopped enforcing DIRECTION too. They
 * are counted separately and the candidate breaking the fewest wins.
 */
function conflictsOf(out: Placed[], c: SequenceCandidate): { hard: string | null; soft: string[] } {
  const n = out.length;
  const runOf = (match: (p: Placed) => boolean): number => {
    let run = 0;
    for (let i = n - 1; i >= 0 && match(out[i]!); i -= 1) run += 1;
    return run;
  };

  let hard: string | null = null;
  if (c.category && runOf((p) => p.c.category === c.category) >= SEQUENCE.MAX_SAME_CATEGORY_RUN) {
    hard = "category_run";
  } else if (
    c.creator &&
    runOf((p) => p.c.creator === c.creator) >= SEQUENCE.MAX_SAME_CREATOR_RUN
  ) {
    hard = "creator_run";
  } else if (c.clusterId) {
    for (let i = n - 1; i >= Math.max(0, n - SEQUENCE.MIN_CLUSTER_GAP); i -= 1) {
      if (out[i]!.c.clusterId === c.clusterId) {
        hard = "semantic_duplicate";
        break;
      }
    }
  }

  // The two runs the archetype harness measured as dominant. Both were uncapped
  // while category and creator were guarded, and both ran longer than either:
  // family to NINE, direction to four. See SEQUENCE for the numbers.
  const soft: string[] = [];
  const family = familyOf(c.reason?.code);
  if (
    family &&
    runOf((p) => familyOf(p.c.reason?.code) === family) >= SEQUENCE.MAX_SAME_FAMILY_RUN
  ) {
    soft.push("family_run");
  }
  if (
    c.moveDirection &&
    runOf((p) => p.c.moveDirection === c.moveDirection) >= SEQUENCE.MAX_SAME_DIRECTION_RUN
  ) {
    soft.push("direction_run");
  }
  return { hard, soft };
}

export interface SequenceInput {
  candidates: SequenceCandidate[];
  idea?: FeedIdeaCandidate | null;
  ideaSlot?: number;
  limit?: number;
  /**
   * Take the candidates IN THE ORDER GIVEN — no re-sort, no rhythm, no diversity.
   *
   * WHY THIS HAD TO EXIST. Everything below assumes a BLEND: it re-sorts the pool
   * on `scored.score` (line ~250) and then walks a rhythm of slot intents,
   * spacing categories and creators so a mixed feed does not read as five crypto
   * markets in a row. All of that is right for For You and all of it is wrong for
   * a ranking. Under "Most Capital" the reader asked one question — where is the
   * money — and a diversity rule that moves the $505 market below the $92 one to
   * vary the category is the interface quietly answering a different question.
   *
   * AND IT REVEALED A LIVE DEFECT. Because the re-sort is unconditional,
   * `orderForMode` — the Tribe / Rivals ranking, its own module with its own
   * tests — has its ORDER discarded on every request; only its `admits` filter
   * ever reached the reader. Another instance of this codebase's signature
   * failure: something computes the right answer and the next stage throws it
   * away. Fixing that is a product decision about the two social modes and is
   * deliberately NOT bundled here; this flag is what lets a lens avoid it.
   *
   * Eligibility still applies — that is correctness, not taste — and re-entry
   * markets stay out, because a ranked list is a ranking and not a mixture.
   */
  preserveOrder?: boolean;
  /**
   * MAY THIS BUILD OFFER MARKETS THE READER HAS ALREADY SEEN?
   *
   * Repeats are the right answer for an exhausted CATALOGUE and the wrong one
   * for an exhausted retrieval window, and the sequencer cannot tell those apart
   * — it sees one pool page and has no idea whether a deeper one exists. So the
   * caller decides, and `buildOpportunityFeed` says no until the reader has dug
   * to the bottom of the catalogue.
   *
   * Defaults to `true` here because this module is a pure function of its input:
   * given a resurfaceable candidate and nothing else, placing it is the useful
   * answer. The POLICY of when to ask lives one layer up.
   */
  allowResurface?: boolean;
}

export interface SequenceResult {
  items: OpportunityFeedItem[];
  engineVersion: number;
  /** Markets the gate removed, with the reason — feed diagnostics. */
  excluded: { onchainId: number; reason: ExclusionReason | null }[];
  /**
   * THERE IS NOTHING LEFT TO SHOW, AT ANY TIER.
   *
   * The distinction this exists to make: a response that returns `limit` items
   * has almost certainly left candidates behind, while a response that empties
   * its pool has genuinely run out. The client cannot tell those apart by
   * counting rows, and inferring "the end" from a short batch is exactly how an
   * interface tells someone they are caught up one poll before more arrives.
   *
   * WHAT THIS USED TO MEAN, AND WHY IT WAS THE WRONG CONTRACT. It was scoped to
   * "the candidate pool minus this session's already-seen markets" — a bounded
   * retrieval window minus a monotonically growing exclusion set — and it was
   * documented as the end of the LENS rather than a claim about the platform.
   * Internally consistent, and it still reached the reader as "You're caught up.
   * You've made a call on every market currently in your feed", which is a claim
   * about the platform and was routinely false. A reader with 600 untouched
   * markets was told discovery was over because a 240-row pool had been walked.
   *
   * It now means what it says: the fresh pool is empty, the RESURFACE tier is
   * empty, and no re-entry is waiting. For a blend that is a real end — every
   * market the pool can see is one the reader decided on — and it is rare enough
   * to be worth saying. For a ranked lens (`preserveOrder`) it keeps its old and
   * correct meaning: the ranking ran out, which is a normal thing for a ranking
   * to do, and the playlist's continuation row says so.
   */
  exhausted: boolean;
}

/**
 * Build the ordered queue. Ineligible markets are dropped BEFORE anything else;
 * only a labelled re-entry can re-enter, capped at one per REENTRY_EVERY cards.
 */
export function sequenceFeed(input: SequenceInput): SequenceResult {
  const limit = Math.min(Math.max(1, input.limit ?? SEQUENCE.DEFAULT_LIMIT), SEQUENCE.MAX_LIMIT);
  const allowResurface = input.allowResurface !== false;

  const excluded: { onchainId: number; reason: ExclusionReason | null }[] = [];
  const pool: SequenceCandidate[] = [];
  /**
   * SHOWN, NOT DECIDED — the second tier, and the reason a finite catalogue can
   * still behave like a feed. See @/domain/feed/eligibility for the line between
   * this and `excluded`. Untouched until `pool` is empty.
   */
  const resurface: SequenceCandidate[] = [];
  const reentries: SequenceCandidate[] = [];

  for (const c of input.candidates) {
    if (c.eligibility.eligible) {
      pool.push(c);
      continue;
    }
    const r = c.eligibility.reason;
    /**
     * A LABELLED CARD BEATS AN UNLABELLED ONE, so a market with a material
     * update takes the re-entry path whichever tier it fell into: "your position
     * is moving" is a better thing to show than the same market carrying its
     * ordinary reason.
     *
     * THE THREE BARRED FROM IT, for three different reasons — unchanged from
     * before the tiers existed, because none of them is about supply:
     *
     *   hidden               an explicit instruction. No market event overrides
     *                        it, and none ever should.
     *   queued_this_session  not history at all. The market is already further
     *                        down THIS queue, so a second placement is a
     *                        duplicate row.
     *   seen_this_session    too soon. A re-entry is rationed to one card in
     *                        REENTRY_EVERY, which is well inside the reach of a
     *                        single sitting — labelling a market the reader
     *                        scrolled past ninety seconds ago as news reads as a
     *                        glitch, whatever the label says. It now falls
     *                        through to `resurface` instead of being dropped,
     *                        which is the whole change: it comes back at the end
     *                        of the queue rather than not at all.
     */
    const banned = r === "hidden" || r === "queued_this_session" || r === "seen_this_session";
    if (c.reentry && !banned) reentries.push(c);
    // Not admitted at all when repeats are barred — which is what makes an
    // otherwise-empty page mean "look deeper" rather than "you are finished".
    else if (c.eligibility.tier === "resurfaced" && allowResurface) resurface.push(c);
    else excluded.push({ onchainId: c.onchainId, reason: r });
  }

  const out: Placed[] = [];
  let reentryIdx = 0;
  /** True once the fresh tier ran out and the queue switched to repeats. */
  let resurfacing = false;

  // A RANKING IS TAKEN AS GIVEN. The caller already sorted on the measure the
  // reader chose, so the composite-score sort and the rhythm below are skipped
  // wholesale — they would replace that ordering with a different one. Note this
  // is not a hypothetical risk: it is precisely what happens to `orderForMode`
  // on every request today. See `preserveOrder`.
  let exhausted: boolean;
  if (input.preserveOrder) {
    for (const c of pool.slice(0, limit)) {
      out.push({ c, adjustments: [], intent: "fill", displaced: [], resurfaced: false });
    }
    /**
     * A RANKING IS ALLOWED TO END, and the resurface tier is not offered to one.
     *
     * "Most Capital" is a promise to descend by capital, and padding its tail
     * with markets the reader has already seen would answer a question nobody
     * asked — the honest end of a finite ranking is the end of it, and the
     * playlist's continuation row hands the reader back to the blend, which is
     * where the never-ending feed lives. So the tier is reported as excluded
     * here rather than silently dropped.
     */
    for (const c of resurface)
      excluded.push({ onchainId: c.onchainId, reason: c.eligibility.reason });
    // Nothing left over: the ranking ran out before the limit did.
    exhausted = pool.length <= limit;
  } else {
    pool.sort((a, b) => b.scored.score - a.scored.score || a.onchainId - b.onchainId);
    reentries.sort((a, b) => b.scored.score - a.scored.score || a.onchainId - b.onchainId);
    /**
     * OLDEST SIGHTING FIRST, then score. `resurfaceAt` is "when this became the
     * least objectionable thing left" (see Eligibility), so ascending is exactly
     * "show me the one they saw longest ago". Score is the tie-break rather than
     * the sort key on purpose: within a tier of things the reader has already
     * been shown, how long ago matters more than how good we think it is —
     * ranking on score alone would hand back the same top few markets forever.
     */
    resurface.sort(
      (a, b) =>
        (a.eligibility.resurfaceAt ?? 0) - (b.eligibility.resurfaceAt ?? 0) ||
        b.scored.score - a.scored.score ||
        a.onchainId - b.onchainId,
    );

    while (
      out.length < limit &&
      (pool.length > 0 || resurface.length > 0 || reentryIdx < reentries.length)
    ) {
      const slot = out.length;
      // Rare, evenly-spaced re-entry slots — never more than 1 in REENTRY_EVERY.
      if (slot > 0 && slot % SEQUENCE.REENTRY_EVERY === 0 && reentryIdx < reentries.length) {
        out.push({
          c: reentries[reentryIdx]!,
          adjustments: [],
          intent: "reentry",
          displaced: [],
          // A re-entry announces itself with a label; `slotIntent` already says
          // where it came from. The repeat flag is about the unlabelled tier.
          resurfaced: false,
        });
        reentryIdx += 1;
        continue;
      }
      /**
       * THE FEED DOES NOT END BECAUSE THE FRESH POOL DID.
       *
       * This line used to be `if (pool.length === 0) break;` — the queue stopped
       * at whatever the fresh tier happened to hold, and `exhausted` then told
       * the client that discovery was over. Everything below is unchanged: the
       * resurface tier is poured into the same pool and placed by the same
       * rhythm, the same category and creator caps, the same duplicate spacing.
       * A repeat is a normal card that has to earn its slot like any other.
       *
       * Poured whole rather than drawn from, because the sort orders are
       * different — `pool` descends by score, `resurface` ascends by sighting
       * age — and merging them by score would let a market seen a minute ago
       * outrank one seen this morning. Emptying the fresh tier first, then
       * walking the second in its own order, is the only sequence that respects
       * both. The flip happens ONCE per build, so a fresh market that arrives on
       * a later poll is still placed above every repeat.
       */
      if (pool.length === 0) {
        if (resurface.length === 0) break;
        pool.push(...resurface);
        resurface.length = 0;
        resurfacing = true;
      }

      const want = RHYTHM[slot % RHYTHM.length]!;
      const adjustments: string[] = [];

      // Prefer the best-scoring candidate whose dominant component matches the
      // slot's intent; fall back to the best remaining one.
      let pick = want === "any" ? -1 : pool.findIndex((c) => c.scored.driver === want);
      let intent: ScoreComponent | "fill" = pick >= 0 ? (want as ScoreComponent) : "fill";
      if (pick < 0) pick = 0;

      /**
       * Walk forward for the first candidate that breaks NOTHING. Failing that,
       * the one that breaks the fewest preferences — and never a guarantee, unless
       * every remaining candidate breaks one, in which case a shorter feed would
       * be the worse outcome.
       *
       * Each skip is recorded against the candidate it skipped, so the placed card
       * can say what it displaced rather than only that it displaced something.
       */
      const skipped = new Map<number, string>();
      let cursor = -1;
      let fewest = { idx: -1, soft: Number.POSITIVE_INFINITY };
      for (let i = pick; i < pool.length; i += 1) {
        const v = conflictsOf(out, pool[i]!);
        if (v.hard) {
          skipped.set(i, v.hard);
          if (!adjustments.includes(v.hard)) adjustments.push(v.hard);
          continue;
        }
        if (v.soft.length === 0) {
          cursor = i;
          break;
        }
        skipped.set(i, v.soft[0]!);
        for (const sft of v.soft) if (!adjustments.includes(sft)) adjustments.push(sft);
        if (v.soft.length < fewest.soft) fewest = { idx: i, soft: v.soft.length };
      }
      if (cursor < 0) {
        // Nothing was clean. Take the least-bad, or — if every candidate broke a
        // guarantee — the best-scoring one, because an unfillable slot is worse.
        cursor = fewest.idx >= 0 ? fewest.idx : pick;
        if (fewest.idx >= 0 && !adjustments.includes("soft_relaxed"))
          adjustments.push("soft_relaxed");
      }
      if (cursor !== pick) intent = "fill";

      // The pool is sorted by score, so everything before `cursor` scored at least
      // as high as the card taking this slot. Each was passed for a knowable
      // reason — record it rather than leaving the ordering to look arbitrary.
      // (Once `resurfacing`, the pool is ordered by sighting age instead, so
      // "displaced" there means passed over in the repeat queue, not outscored.)
      const displaced: DisplacedCandidate[] = [];
      for (let i = 0; i < cursor && displaced.length < MAX_DISPLACED; i += 1) {
        const c = pool[i]!;
        displaced.push({
          onchainId: c.onchainId,
          score: c.scored.score,
          why: skipped.get(i) ?? (want === "any" ? "outranked" : `slot wanted ${want}`),
        });
      }

      const [chosen] = pool.splice(cursor, 1);
      out.push({ c: chosen!, adjustments, intent, displaced, resurfaced: resurfacing });
    }
    /**
     * The blended loop SPLICES what it places, so empty really is empty. All
     * three tiers have to be spent before this is true — which is the whole
     * point of the change: the fresh pool running dry is now a fact about
     * retrieval, and only this is a fact about the reader.
     */
    exhausted = pool.length === 0 && resurface.length === 0 && reentryIdx >= reentries.length;
  }

  const items: OpportunityFeedItem[] = out.map((p, i) => ({
    kind: "market",
    position: i,
    onchainId: p.c.onchainId,
    score: p.c.scored.score,
    primaryReason: p.c.reentry ? p.c.reentry.detail : (p.c.reason?.text ?? null),
    reasonCode: p.c.reentry ? "reentry" : (p.c.reason?.code ?? null),
    reentryLabel: p.c.reentry?.label ?? null,
    reentryDetail: p.c.reentry?.detail ?? null,
    opportunityType: null,
    diagnostics: {
      eligible: p.c.eligibility.eligible,
      exclusionReason: p.c.eligibility.reason,
      score: p.c.scored.score,
      components: p.c.scored.components,
      driver: p.c.scored.driver,
      acceleration: p.c.scored.acceleration,
      ageHours: p.c.scored.ageHours,
      clusterId: p.c.clusterId,
      diversityAdjustments: p.adjustments,
      slotIntent: p.intent,
      resurfaced: p.resurfaced,
      reasonCode: p.c.reentry ? "reentry" : (p.c.reason?.code ?? null),
      poolSlices: p.c.poolSlices ?? [],
      displaced: p.displaced,
    },
  }));

  if (input.idea && items.length >= SEQUENCE.IDEA_MIN_POSITION) {
    const slot = Math.min(
      Math.max(input.ideaSlot ?? SEQUENCE.IDEA_MIN_POSITION, SEQUENCE.IDEA_MIN_POSITION),
      items.length,
    );
    items.splice(slot, 0, {
      kind: "market_idea",
      position: slot,
      suggestionId: input.idea.id,
      question: input.idea.question,
      category: input.idea.category,
      shortReason: input.idea.shortReason,
    });
    items.forEach((it, i) => {
      it.position = i;
    });
  }

  return { items, engineVersion: FEED_ENGINE_VERSION, excluded, exhausted };
}
