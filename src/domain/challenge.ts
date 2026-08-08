/**
 * CHALLENGE — someone you trust took a side, and you have not answered.
 *
 * THE DISTINCTION THIS WHOLE MODULE EXISTS TO HOLD. "Show me markets involving
 * my Tribe" is BROWSING, and it already lives in the left rail as a
 * `FeedNetwork` filter. "Mike, who I disagree with about everything, just took
 * YES on a question I have not answered" is an OBLIGATION — a thing that exists
 * because of a relationship, that did not exist yesterday, and that stops
 * existing the moment I answer it.
 *
 * Those are different intents and they belong in different places. Putting
 * Challenge into the left rail's filters would blur them, and the blur is
 * expensive: a filter is something you choose to look at, a call is something
 * waiting for you.
 *
 * WHAT REPLACED WHAT. This is `for-you.ts` narrowed from five kinds to one
 * shape. `similar` ("you backed 3 markets like this") and `followed` are
 * RECOMMENDATIONS — true, useful, and not calls; nobody is waiting on your
 * answer. `invited` was a person pressing a button, which the invitation system
 * took a whole table and a rail to express and which nobody ever used. What is
 * left is the only version with a real social debt in it.
 *
 * SO A CALLER MUST BE SOMEONE THE ENGINE HAS ACTUALLY CLASSIFIED — Twin, Tribe,
 * Rival or Opp, by canonical DNA. Not "someone active in your category". A
 * stranger's position is news; a Twin's position is a question addressed to you.
 *
 * THE RULE SURVIVES VERBATIM FROM `for-you.ts`: a row may appear only if the
 * system can state why THIS person, and there is deliberately no fallback
 * string anywhere in the path. `reasonFor` returns null and the row does not
 * exist. A default reason would make the gate unfalsifiable, because everything
 * would pass it.
 *
 * ZERO IO, pure, fully testable.
 */
import type { RelationshipLabel } from "@/domain/dna/config";
import { callLine } from "@/domain/call-line";
import {
  dnaStage,
  decisionsToNextStage,
  stageAtLeast,
  type DnaStage,
} from "@/domain/conviction-dna";

/**
 * Who is allowed to call you. The engine's own labels, not a parallel set —
 * `opp` reads as "Rival" and `inverse` as the earned "Opp", and that mapping
 * lives once in RELATIONSHIP_TEXT.
 *
 * `neutral` and `insufficient` are deliberately absent. A relationship the
 * engine could not establish cannot create an obligation.
 */
export type CallerRelation = Extract<RelationshipLabel, "twin" | "tribe" | "opp" | "inverse">;

export const CALLER_RELATIONS: readonly CallerRelation[] = [
  "twin",
  "tribe",
  "inverse",
  "opp",
] as const;

/** How loudly a relation speaks. A Twin and an Opp are the two sharp ends. */
const RELATION_RANK: Record<CallerRelation, number> = {
  twin: 4,
  inverse: 3,
  opp: 2,
  tribe: 1,
};

/** A person named in a call. Anonymous people are counted, never named. */
export interface NamedPerson {
  wallet: string;
  /** Display name, or null when this person has never set one. */
  name: string | null;
}

/**
 * What the caller did. `trade` carries a side; `market_created` does not — a
 * creator has staked the question, not necessarily an answer to it.
 */
export type CallAct = "trade" | "market_created";

export interface CallEvidence {
  marketId: number;
  title: string;
  caller: NamedPerson;
  relation: CallerRelation;
  act: CallAct;
  /** The side they took. Null for a creation, and null is not a failure. */
  callerSide: "YES" | "NO" | null;
  /**
   * The pair's shared record — same-side count and shared total.
   *
   * Already sitting in `viewer_dna_cache` as `sameSideBeliefs`/`sharedBeliefs`
   * and thrown away by `qualifiedCallers`, which read the buckets for wallets
   * and dropped everything else. Carrying it costs nothing and is what lets the
   * card show Conviction Match and the line say what is at stake between these
   * two people rather than a generic prompt.
   */
  together: number | null;
  shared: number | null;
  atMs: number;
}

export interface Challenge {
  marketId: number;
  title: string;
  caller: NamedPerson;
  relation: CallerRelation;
  callerSide: "YES" | "NO" | null;
  /** Same-side count and shared total. Null when the pair has no record. */
  together: number | null;
  shared: number | null;
  /** Why THIS person. Never empty — a row without one does not exist. */
  reason: string;
  atMs: number;
}

export const CHALLENGE = {
  /**
   * Open calls shown at once. Beyond this it stops reading as a set of things
   * waiting for you and starts reading as a feed — and the feed already exists,
   * one tab across.
   */
  /** Shown at once. Beyond a railful it stops reading as a set of things waiting
   *  for you and starts reading as a feed — so the rest are one tap away rather
   *  than discarded. */
  maxOpen: 6,
  /** The stage at which the social system unlocks. */
  unlockAt: "recognizable" as DnaStage,
  /**
   * How far back a caller's act can be and still be a live call — and therefore
   * how long a call stays reachable at all.
   *
   * IT LIVES HERE BECAUSE THREE THINGS MUST AGREE ON IT: what the rail derives,
   * which calls are still waiting rather than out of reach, and what the
   * showing-up denominator counts. It was a server-only constant, which meant a
   * profile could show someone waiting on a call their caller can no longer see.
   */
  windowDays: 30,
} as const;

/**
 * THE RULE. The sentence that makes this a call, or null.
 *
 * The rule itself is unchanged and is the one the whole surface rests on: a row
 * may appear only if the system can state why THIS person, with no fallback
 * string anywhere. What changed is the sentence.
 *
 * IT USED TO HAVE TWO SHAPES — "X, your Tribe, took YES. What's your call?" and
 * "X, your Rival, asked this. What's your call?" — so six open Challenges read
 * as six near-identical rows and the eye stopped on none of them. Composition
 * moved to @/domain/call-line, which builds a line from what they did plus what
 * SIDE-BLIND BY CONSTRUCTION. The sentence used to vary by relationship, arguing
 * agreement in both directions — "This could be the one you split on" to a Tribe
 * member, "Agreeing here would be new" to a Rival. Both made a Challenge sound
 * like a question about matching. It is not: it means I saw this and I want to
 * know where you land, and YES and NO satisfy it identically. `callLine` no longer
 * receives the relation at all, so the copy cannot drift back.
 */
export function reasonFor(e: CallEvidence): string | null {
  // The relationship and the shared record are DELIBERATELY not passed. A
  // Challenge asks one thing — where do you land — and answering YES or NO
  // satisfies it identically, so the sentence must have no way to argue about
  // agreement. `together`/`shared` still travel on the Challenge itself, where
  // the card prints them as the Conviction Match line.
  return callLine({
    name: e.caller.name ?? "",
    act: e.act,
    side: e.callerSide,
    marketId: e.marketId,
    callerWallet: e.caller.wallet,
  });
}

export interface ComposeOptions {
  /**
   * Markets the viewer has already acted in. A call you have answered is not a
   * quieter call — it is not a call at all, and this is the single most
   * important exclusion in the module.
   */
  answered?: ReadonlySet<number>;
  max?: number;
}

/**
 * Evidence → open Challenges.
 *
 * ONE MARKET, ONE CALL, and the strongest caller keeps it. If a Twin and a
 * Tribe member both took a side in the same market, that is one question in
 * front of you, not two — and it is the Twin's, because that is the
 * relationship with the most standing to ask.
 *
 * Ordering is relation first, then recency. A Twin's month-old question
 * outranks a Tribe member's from this morning: the panel's promise is that
 * everything on it is addressed to you by someone who matters, and sorting by
 * time first would bury the sharpest call under the newest one.
 */
export function composeChallenges(
  evidence: readonly CallEvidence[],
  opts: ComposeOptions = {},
): Challenge[] {
  const answered = opts.answered ?? new Set<number>();
  const best = new Map<number, Challenge>();

  for (const e of evidence) {
    if (answered.has(e.marketId)) continue;
    // A CALL WITH NO QUESTION IS NOT A CALL. This gate used to live inside the
    // sentence composer, which is where it stopped being obvious — the composer
    // moved to call-line, which never sees the title, and the guard would have
    // gone with it. A card whose only market identity is blank is worse than no
    // card: the reader is asked to weigh in on nothing.
    if (!e.title.trim()) continue;
    const reason = reasonFor(e);
    if (!reason) continue;
    const row: Challenge = {
      marketId: e.marketId,
      title: e.title,
      caller: e.caller,
      relation: e.relation,
      callerSide: e.callerSide,
      together: e.together,
      shared: e.shared,
      reason,
      atMs: e.atMs,
    };
    const prev = best.get(e.marketId);
    if (
      !prev ||
      RELATION_RANK[row.relation] > RELATION_RANK[prev.relation] ||
      (RELATION_RANK[row.relation] === RELATION_RANK[prev.relation] && row.atMs > prev.atMs)
    ) {
      best.set(e.marketId, row);
    }
  }

  return (
    [...best.values()]
      .sort(
        (a, b) =>
          RELATION_RANK[b.relation] - RELATION_RANK[a.relation] ||
          b.atMs - a.atMs ||
          a.marketId - b.marketId,
      )
      // NO SILENT TRUNCATION. This used to cut at a railful and throw the rest
      // away, which was defensible when calls were inferred and roughly
      // interchangeable. Now every one is somebody's deliberate act, and dropping
      // it before the reader ever learns it exists loses a real request. The rail
      // pages through them and says how many are behind; `max` remains for callers
      // that genuinely want a bounded slice.
      .slice(0, opts.max ?? Number.MAX_SAFE_INTEGER)
  );
}

/* ── The lock ────────────────────────────────────────────────────────────── */

export interface ChallengeLock {
  unlocked: boolean;
  /** The heading inside the locked panel. */
  title: string;
  /** Filled dots out of total, for the progress row. */
  filled: number;
  total: number;
  /** One honest line about what is still needed. Null once unlocked. */
  detail: string | null;
}

/**
 * Whether the social system is open to this viewer, and what to say if not.
 *
 * SHOW THE LOCKED DESTINATION, DO NOT HIDE THE TAB. A hidden feature teaches
 * nobody anything; a visible locked one gives a reason to build the DNA that
 * opens it. The cost of showing it is one tab that says what it is for.
 *
 * THE THRESHOLD IS NOT NEW. `dnaStage` already puts "recognizable" at exactly
 * five decisions and `decisionsToNextStage` already produces the "2 more" copy.
 * Inventing a second five here would be a second answer to one question — the
 * exact failure this codebase keeps paying for.
 *
 * AND UNLOCKING DOES NOT MANUFACTURE ANYONE. Five decisions grants access to
 * the system; the DNA engine still decides whether a single person qualifies to
 * call you. An unlocked, empty Challenge panel is a correct state, not a bug,
 * and the copy must not promise otherwise.
 */
export function challengeLock(decisions: number, hasTwinCandidate = false): ChallengeLock {
  const d = Math.max(0, Math.floor(decisions));
  const stage = dnaStage({ decisions: d, hasTwinCandidate });
  const unlocked = stageAtLeast(stage, CHALLENGE.unlockAt);
  const next = decisionsToNextStage(d);
  // The bar is drawn to the UNLOCK, not to whatever stage comes next — past
  // five there is nothing left to fill, and a bar that keeps growing after the
  // thing it gates has opened is measuring something the reader did not ask about.
  const total = 5;

  if (unlocked) {
    return { unlocked: true, title: "Challenge", filled: total, total, detail: null };
  }

  const need = next && next.next === CHALLENGE.unlockAt ? next.need : Math.max(0, total - d);
  return {
    unlocked: false,
    title: "Find Your People",
    filled: Math.min(d, total),
    total,
    detail:
      d === 0
        ? `Take ${total} sides and we'll work out who your people are.`
        : `${need} more and we'll know who your Tribe and Rivals are.`,
  };
}

/* ── The reverse event ───────────────────────────────────────────────────── */

/**
 * IT MOVED, RATHER THAN BEING DELETED. `answeredNotices` composed a dismissible
 * "SARAH SHOWED UP" card that sat above the open list and was acknowledged into
 * localStorage. That was the wrong shape for the right fact: somebody answering a
 * call your conviction created is the most durable social evidence this platform
 * produces, and it was being thrown away when a reader tapped ×.
 *
 * It now lives in @/domain/dependability, where it accumulates into a relationship
 * instead of expiring. Nothing replaced it here — the rail is an action queue, and
 * a queue with completed items in it is a to-do list.
 */

/* ── Call feedback ───────────────────────────────────────────────────────── */

export interface CallReach {
  tribe: number;
  rivals: number;
}

/**
 * "Your people got the call" — what to say after a market is created or a side
 * is taken.
 *
 * NEVER "NOTIFIED". There is no notification channel on this platform: no
 * email, no push, no service worker, no inbox. Saying anyone was notified would
 * be a straightforward lie. "Got the call" is true in the only sense available
 * — this market is now eligible for their Challenge surface — and it is the
 * same sentence for creation and for participation, which is why neither needs
 * its own recruitment system.
 */
export function callReachLine(reach: CallReach): string | null {
  const parts: string[] = [];
  if (reach.tribe > 0) parts.push(`${reach.tribe} Tribe`);
  if (reach.rivals > 0) parts.push(`${reach.rivals} ${reach.rivals === 1 ? "Rival" : "Rivals"}`);
  // Nobody qualifies yet. Silence beats "0 Tribe · 0 Rivals", which reads as a
  // scoreboard the reader is losing rather than a network still forming.
  return parts.length > 0 ? parts.join(" · ") : null;
}
