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
import { RELATIONSHIP_TEXT } from "@/lib/dna-labels";
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
  atMs: number;
}

export interface Challenge {
  marketId: number;
  title: string;
  caller: NamedPerson;
  relation: CallerRelation;
  callerSide: "YES" | "NO" | null;
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
  maxOpen: 6,
  /** Answered-call notices shown before they become history. */
  maxAnswered: 3,
  /** The stage at which the social system unlocks. */
  unlockAt: "recognizable" as DnaStage,
} as const;

/** "your Twin" / "your Rival" — the possessive is what makes it a call. */
function possessive(relation: CallerRelation): string {
  return `your ${RELATIONSHIP_TEXT[relation]}`;
}

/**
 * THE RULE. The sentence that makes this a call, or null.
 *
 * WHAT CHANGED FROM `for-you.ts`, and it is the substantive change rather than
 * a rename. The old Rival row required `viewerSide` — it could only say "took
 * the other side of your YES" — and returned null without one. That is exactly
 * backwards for Challenge, which by definition targets markets you have NOT
 * answered. There is no "other side" yet, because you have not taken one.
 *
 * So the sentence states what THEY did and asks for yours. It never implies a
 * position you do not hold.
 */
export function reasonFor(e: CallEvidence): string | null {
  const name = e.caller.name?.trim();
  if (!name) return null;
  if (!e.title.trim()) return null;

  if (e.act === "market_created") {
    return `${name}, ${possessive(e.relation)}, asked this. What's your call?`;
  }

  // A trade with no side is not evidence of anything answerable — a caller who
  // did something we cannot name cannot be quoted asking you a question.
  if (e.callerSide !== "YES" && e.callerSide !== "NO") return null;
  return `${name}, ${possessive(e.relation)}, took ${e.callerSide}. What's your call?`;
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
    const reason = reasonFor(e);
    if (!reason) continue;
    const row: Challenge = {
      marketId: e.marketId,
      title: e.title,
      caller: e.caller,
      relation: e.relation,
      callerSide: e.callerSide,
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

  return [...best.values()]
    .sort(
      (a, b) =>
        RELATION_RANK[b.relation] - RELATION_RANK[a.relation] ||
        b.atMs - a.atMs ||
        a.marketId - b.marketId,
    )
    .slice(0, opts.max ?? CHALLENGE.maxOpen);
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
        ? `Take ${total} sides to start finding your Tribe and Rivals.`
        : `${need} more to start finding your Tribe and Rivals.`,
  };
}

/* ── The reverse event ───────────────────────────────────────────────────── */

export interface AnsweredCall {
  marketId: number;
  title: string;
  responder: NamedPerson;
  respondedAtMs: number;
}

export interface AnsweredNotice {
  marketId: number;
  title: string;
  /** "SARAH SHOWED UP" */
  headline: string;
  /** "Sarah answered your call." */
  body: string;
  respondedAtMs: number;
}

/**
 * Somebody answered a call your own participation created.
 *
 * THIS IS THE ONLY EVENT THAT COUNTS TOWARD DEPENDABILITY, and the precision
 * matters. Not "Sarah happened to participate in something I participated in" —
 * that is a coincidence, and on a small platform coincidences are common. The
 * claim is causal: my participation created a call for Sarah, and Sarah
 * subsequently answered it. The server proves the ordering; this only speaks it.
 *
 * It occupies the top of the panel briefly and then becomes history. An
 * acknowledgement that never leaves is an actionable slot permanently spent on
 * something with no action in it.
 */
export function answeredNotices(
  answers: readonly AnsweredCall[],
  max = CHALLENGE.maxAnswered,
): AnsweredNotice[] {
  return answers
    .filter((a) => !!a.responder.name?.trim() && !!a.title.trim())
    .sort((a, b) => b.respondedAtMs - a.respondedAtMs || a.marketId - b.marketId)
    .slice(0, max)
    .map((a) => {
      const name = a.responder.name!.trim();
      return {
        marketId: a.marketId,
        title: a.title,
        headline: `${name.toUpperCase()} SHOWED UP`,
        body: `${name} answered your call.`,
        respondedAtMs: a.respondedAtMs,
      };
    });
}

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
