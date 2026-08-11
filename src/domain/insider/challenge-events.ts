/**
 * ONE HUMAN ACTION, ONE EVENT — the semantic layer over Challenge activity.
 *
 * THE FAILURE THIS EXISTS TO PREVENT is a tape that reports database mutations.
 * Casey buying NO in a market where she had been challenged writes two rows: a
 * trade, and a `responded_at` stamp. Rendered as two entries the tape says
 * "Casey traded NO" and then "Casey answered John's Challenge", which is one
 * person doing one thing, told twice, with the second telling stealing the point
 * of the first. Every mechanical write is not an event.
 *
 * So a trade that answers a Challenge collapses into the ANSWER, because that is
 * the larger and more human fact:
 *
 *     CASEY BACKED NO
 *     Answered John's Challenge.
 *
 * THE PRIVACY BOUNDARY IS THE SAME ONE AS THE CHAIN VIEW, and it has to be —
 * a leak here would be the same leak, arriving through a feed instead of a
 * lineage. Insider may name people who took a public directional position,
 * people who answered, and people who deliberately relayed. It may NEVER name a
 * passer, an eligible-but-unasked wallet, or somebody waiting in a stranger's
 * branch. Available data is not visible data, so the input type below carries no
 * field for any of them.
 *
 * COUNT SEMANTICS TRAVEL WITH THE SENTENCE. `tables` are recipient
 * opportunities and are never called people; `believers` are humans and are.
 *
 * ZERO IO, pure, fully testable.
 */
import type { Side } from "@/domain/insider/types";

/**
 * WHAT ACTUALLY HAPPENED — one per human act, never one per row written.
 *
 * The kinds are ordered by how much they are worth interrupting somebody for,
 * and `EVENT_RANK` below encodes that. `challenge_response` leads because it is
 * the only one where a person did something BECAUSE somebody else asked.
 */
export type ChallengeEventKind =
  | "challenge_response"
  | "first_believer"
  | "new_believer"
  | "relay"
  | "challenge_complete"
  | "added"
  | "reduced"
  | "left_side";

export interface EventPerson {
  wallet: string;
  name: string;
}

/**
 * THE FACTS AN EVENT MAY BE BUILT FROM.
 *
 * Deliberately narrow. There is no `passers`, no `audience`, no `waiting` — a
 * component cannot render what the type cannot carry, and a future reader cannot
 * be asked to supply it "just for context".
 */
export interface ChallengeEventInput {
  kind: ChallengeEventKind;
  marketId: number;
  /** Who acted. Always somebody who took a public, deliberate action. */
  actor: EventPerson;
  atMs: number;
  /** The side they took, when the act had one. */
  side?: Side | null;
  /**
   * WHOSE CHALLENGE THEY ANSWERED — the canonical primary caller, not "one of
   * the people who asked". The chain and the durable card both name this person,
   * and a third answer here would be a third owner.
   */
  answeredCaller?: EventPerson | null;
  /** Believers in this market AFTER the act. Null when the count is unknown. */
  believersNow?: number | null;
  /** Recipient opportunities a relay created. Tables, never people. */
  relayReach?: number | null;
  /** Completion, straight from the lifecycle projection. */
  completion?: { showedUp: number; reached: number } | null;
  /**
   * PROVEN TO STILL HOLD SOMETHING after reducing. Only a balance can establish
   * it, so it is a fact rather than an inference — "she is still in" said about
   * somebody who fully exited is the kind of small lie this tape must not tell.
   */
  stillIn?: boolean | null;
  /**
   * WHICH ACT THIS IS, when one person can do this thing more than once.
   *
   * THE COLLAPSE KEY IS (MARKET, ACTOR) AND THAT IS RIGHT FOR A TRADE. Buying
   * and the `responded_at` stamp it produced are two rows and one human act, so
   * merging them is the whole point of `collapseEvents`.
   *
   * IT IS WRONG FOR A RELAY. Nothing stops somebody putting a question up,
   * taking it down and putting it up again — `challenges_active_market_idx` is
   * unique only `WHERE closed_at IS NULL`. Those are two decisions on two days,
   * and merged by wallet they would become one event carrying both reaches at
   * the later timestamp: "the question is now on 11 more tables", this morning,
   * when eight of them opened last week.
   *
   * Set it to the identity of the ACT and those events stop merging with each
   * other — and with a trade in the same market, which is a different act too.
   * Left unset, the collapse behaves exactly as it always has.
   */
  actKey?: string;
}

export interface SemanticEvent {
  kind: ChallengeEventKind;
  marketId: number;
  /** Carried through so a consumer can key a row by the ACT. See the input. */
  actKey: string | null;
  headline: string;
  support: string | null;
  atMs: number;
  actorWallet: string;
}

/**
 * HUMAN ACTIVITY LEADS AND EARNINGS DO NOT APPEAR HERE AT ALL.
 *
 * Higher wins. The order is the brief's: an answer to somebody's Challenge, then
 * a new person entering the question, then a relay, then a position change.
 * Nothing in this module can emit a money event — a tape that ranked earnings
 * would be a ledger with a headline font.
 */
const EVENT_RANK: Record<ChallengeEventKind, number> = {
  challenge_response: 8,
  first_believer: 7,
  new_believer: 6,
  relay: 5,
  challenge_complete: 4,
  added: 3,
  reduced: 2,
  left_side: 1,
};

export function eventRank(kind: ChallengeEventKind): number {
  return EVENT_RANK[kind];
}

const upper = (s: string) => s.toUpperCase();

/** The union is closed. A new kind lands here as a type error. */
function assertNever(x: never): never {
  throw new Error(`unhandled challenge event: ${JSON.stringify(x)}`);
}

/**
 * COMPOSE THE ONE SENTENCE PAIR — headline in the tape's voice, support beneath.
 *
 * Every branch says only what its input proves. A missing believer count, a
 * missing side, an unproven "still in" all drop the clause rather than guessing
 * it: the tape's whole value is that a reader can believe the small sentences.
 */
export function semanticEvent(i: ChallengeEventInput): SemanticEvent {
  const who = i.actor.name.trim();
  const base = {
    kind: i.kind,
    marketId: i.marketId,
    atMs: i.atMs,
    actorWallet: i.actor.wallet,
    actKey: i.actKey ?? null,
  };

  switch (i.kind) {
    /**
     * THE TRADE AND THE ANSWER ARE ONE EVENT. The headline is what they DID —
     * a public directional position — and the answer is the reason underneath.
     * Two entries would tell one act twice and let the second steal the point.
     */
    case "challenge_response": {
      const caller = i.answeredCaller?.name.trim();
      return {
        ...base,
        headline: upper(i.side ? `${who} backed ${i.side}` : `${who} showed up`),
        support: caller ? `Answered ${caller}'s Challenge.` : "Answered a Challenge.",
      };
    }

    case "first_believer":
      return {
        ...base,
        headline: "YOUR FIRST BELIEVER SHOWED UP",
        support: i.side ? `${who} backed ${i.side}.` : `${who} took a side.`,
      };

    case "new_believer":
      return {
        ...base,
        headline: upper(i.side ? `${who} backed ${i.side}` : `${who} took a side`),
        // Null count says nothing rather than "0 believers now".
        support:
          i.believersNow != null && i.believersNow > 0
            ? `${i.believersNow} believer${i.believersNow === 1 ? "" : "s"} now.`
            : null,
      };

    /**
     * TABLES, NOT PEOPLE. A relay creates recipient opportunities, and once a
     * chain forks the same person can hold two of them.
     */
    case "relay":
      return {
        ...base,
        headline: upper(`${who} kept it moving`),
        support:
          i.relayReach != null && i.relayReach > 0
            ? `The question is now on ${i.relayReach} more table${i.relayReach === 1 ? "" : "s"}.`
            : null,
      };

    /**
     * COMPLETION COMES FROM THE LIFECYCLE, NEVER FROM ARITHMETIC HERE. Without
     * the canonical pair there is no completion event worth printing.
     */
    case "challenge_complete": {
      const c = i.completion;
      if (c && c.reached > 0 && c.showedUp >= c.reached)
        return { ...base, headline: "EVERYONE SHOWED UP", support: null };
      return {
        ...base,
        headline: "YOUR CHALLENGE IS COMPLETE",
        support: c && c.reached > 0 ? `${c.showedUp} of ${c.reached} showed up.` : null,
      };
    }

    case "added":
      return {
        ...base,
        headline: upper(i.side ? `${who} added to ${i.side}` : `${who} added`),
        support: null,
      };

    case "reduced":
      return {
        ...base,
        headline: upper(i.side ? `${who} reduced ${i.side}` : `${who} reduced`),
        /**
         * ONLY WHEN HOLDINGS PROVE IT. "She is still in" about somebody who
         * fully exited is exactly the small confident lie this tape cannot
         * afford, and only a balance can establish it.
         */
        support: i.stillIn === true ? "Still in." : null,
      };

    case "left_side":
      return {
        ...base,
        headline: upper(i.side ? `${who} left ${i.side}` : `${who} left a side`),
        support: null,
      };

    default:
      return assertNever(i.kind);
  }
}

/**
 * COLLAPSE ONE PERSON'S MECHANICAL WRITES INTO WHAT THEY DID.
 *
 * Keyed by (market, actor): a trade and the Challenge answer it produced are the
 * same human act, and the strongest KIND wins. Everything else about the event
 * comes from the winning input, so the answer's caller and the trade's side both
 * survive when they are merged — which is how "CASEY BACKED NO / Answered John's
 * Challenge." exists at all.
 *
 * Ordering is deliberately irrelevant: the merge is by rank, not by arrival, so
 * a source that emits the stamp before the trade produces the same event.
 */
export function collapseEvents(inputs: readonly ChallengeEventInput[]): ChallengeEventInput[] {
  const best = new Map<string, ChallengeEventInput>();
  for (const i of inputs) {
    /**
     * THE ACT, WHEN THE CALLER NAMED ONE. Without `actKey` this is the original
     * (market, actor) key and a trade still merges with the answer it produced.
     * With one, two separate decisions by the same person stay two events.
     */
    const key = `${i.marketId}|${i.actor.wallet.toLowerCase()}|${i.actKey ?? ""}`;
    const held = best.get(key);
    if (!held) {
      best.set(key, i);
      continue;
    }
    const winner = eventRank(i.kind) > eventRank(held.kind) ? i : held;
    const other = winner === i ? held : i;
    /**
     * THE LOSER'S FACTS ARE NOT DISCARDED, only its kind. A trade collapsed into
     * an answer still carries the side that was taken; an answer collapsed into
     * a trade still carries who was answered.
     */
    best.set(key, {
      ...winner,
      side: winner.side ?? other.side ?? null,
      answeredCaller: winner.answeredCaller ?? other.answeredCaller ?? null,
      believersNow: winner.believersNow ?? other.believersNow ?? null,
      relayReach: winner.relayReach ?? other.relayReach ?? null,
      completion: winner.completion ?? other.completion ?? null,
      stillIn: winner.stillIn ?? other.stillIn ?? null,
      actKey: winner.actKey ?? other.actKey ?? undefined,
      atMs: Math.max(winner.atMs, other.atMs),
    });
  }
  return [...best.values()];
}

/** Collapse, compose, and order by what is worth interrupting somebody for. */
export function semanticEvents(inputs: readonly ChallengeEventInput[]): SemanticEvent[] {
  return collapseEvents(inputs)
    .map(semanticEvent)
    .sort((a, b) => eventRank(b.kind) - eventRank(a.kind) || b.atMs - a.atMs);
}

/**
 * WORDS THE TAPE MUST NEVER USE ABOUT A CHALLENGE.
 *
 * `passed` and `declined` are here because a passer is never named and never
 * counted on this surface — the creator learns a number on their own card, and a
 * feed entry would be a ledger of rejection with a person attached. `eligible`
 * and `audience` are here because being in a set is not an act, and a tape
 * reports acts.
 */
export const INSIDER_CHALLENGE_BANNED: readonly string[] = [
  "passed",
  "declined",
  "rejected",
  "ignored",
  "eligible",
  "audience",
  "notified",
  "invited",
  "accepted",
  "against you",
];

/** Everything one event can say, for the banned-word gate. */
export function eventVocabulary(e: SemanticEvent): string {
  return [e.headline, e.support].filter(Boolean).join(" ");
}
