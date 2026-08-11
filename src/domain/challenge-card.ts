/**
 * ONE LIVING CARD PER VIEWER PER MARKET — a state machine, not five components.
 *
 * THE FAILURE THIS EXISTS TO PREVENT is the one post-action already paid for.
 * Left alone, this surface becomes `IncomingChallengeCard`,
 * `AnsweredChallengeCard`, `OutgoingChallengeCard`, `RelayChallengeCard` and
 * `CompletedChallengeCard` — five separate truths about the same relationship,
 * each rendering whatever it can see, none able to see the others. A reader who
 * was brought in by Maya, answered, relayed, and had two people show up would
 * appear in several of them at once.
 *
 * So there is ONE projection per (viewer, market), it carries a single `state`,
 * and the component renders that. A card cannot be in two states, because the
 * type does not permit it.
 *
 *   WAITING            somebody brought me in and I have not answered
 *   SHOWED_UP          I answered them
 *   BRANCH_LIVE        I put it in front of my people, nobody has answered yet
 *   PEOPLE_SHOWING_UP  my people are answering
 *   CHAIN_MOVING       my people are carrying it further
 *   FINISHED           everyone responded or passed, or the market ended
 *
 * THE STATES ARE ORDERED BY WHAT IS NEWEST, not by lifecycle position. A branch
 * that is both live and has responses is `people_showing_up`, because the
 * responses are the news. `chain_moving` outranks that in turn: somebody
 * carrying your question to their own people is a larger event than somebody
 * answering it.
 *
 * COUNT SEMANTICS ARE LOAD-BEARING AND EASY TO GET WRONG:
 *
 *   showedUp     UNIQUE CONFIRMED RESPONDERS. Not call rows.
 *   keptItMoving UNIQUE PEOPLE who created a child Challenge. Not child rows.
 *   reached      recipient OPPORTUNITIES, which are not people once a chain
 *                forks — the same person can be reached by two branches.
 *
 * "42 people joined" when the data means 42 call rows is the exact lie this
 * module refuses to be able to tell: nothing here composes a sentence from
 * `reached` that uses the word "people" without saying "tables" instead.
 *
 * ZERO IO, pure, fully testable.
 */
import type { Side } from "@/domain/post-action";

export type CardState =
  | "waiting"
  | "showed_up"
  | "branch_live"
  | "people_showing_up"
  | "chain_moving"
  | "finished";

export interface CardPerson {
  wallet: string;
  name: string;
  avatarUrl: string | null;
}

/**
 * ONE ACT OF KEEPING IT MOVING — not one person who did.
 *
 * THE DISTINCTION IS LOAD-BEARING AND THE SCHEMA IS THE REASON.
 * `challenges_active_market_idx` is unique on `(challenger_wallet, market_id)
 * WHERE closed_at IS NULL`: it stops two SIMULTANEOUS Challenges, and nothing
 * stops John putting the question up, taking it down, and putting it up again.
 * `put_on_table` refuses only `already_up`, the children read carries no closed
 * filter, and a `parent_call` may be relayed from more than once. So one person
 * really can have several relay acts on one market.
 *
 * KEYED BY WALLET, THOSE ACTS COLLAPSE INTO A LIE. Sum the reach and take the
 * latest timestamp and the tape says "John kept it moving — the question is now
 * on 11 more tables", dated this morning, when eight of those tables were opened
 * last week. Two human actions become one event carrying cumulative reach at the
 * wrong moment — a sentence that looks checkable and is not.
 *
 * So this is an ACT: its own challenge, its own time, its own reach. Surfaces
 * that mean PEOPLE — "3 people kept it moving", a face row — call `relayPeople`
 * and dedupe explicitly, which is the one place that decision now lives.
 */
export interface CardRelayer extends CardPerson {
  /** The child Challenge this act created. The act's identity. */
  challengeId: number;
  atMs: number;
  /** Recipient opportunities THIS act created. Tables, not people. */
  reach: number;
}

/**
 * THE PEOPLE BEHIND THE ACTS, first appearance kept.
 *
 * "3 people kept it moving" is a claim about three humans, and counting acts
 * there would inflate it every time one of them re-issued.
 */
export function relayPeople(acts: readonly CardRelayer[]): CardPerson[] {
  const seen = new Set<string>();
  const out: CardPerson[] = [];
  for (const a of acts) {
    const w = a.wallet.toLowerCase();
    if (seen.has(w)) continue;
    seen.add(w);
    out.push({ wallet: a.wallet, name: a.name, avatarUrl: a.avatarUrl });
  }
  return out;
}

/** A person who answered, and which way they went at that moment. */
export interface CardResponder extends CardPerson {
  /** Null on rows stamped before the side was kept. The card prints none. */
  side: Side | null;
  atMs: number;
}

/**
 * WHO BROUGHT THE VIEWER IN — every active caller, and the one that owns lineage.
 *
 * THE CANONICAL PARENT IS THE EARLIEST STILL-ACTIVE CALL, and the same person
 * must be shown first, credited as `primaryCaller`, and written as `parent_call`.
 * Displaying the STRONGEST RELATIONSHIP while secretly assigning ancestry to
 * somebody else would make the provenance line and the chain disagree about who
 * brought this reader in — one of them visible, one of them permanent.
 */
export interface Incoming {
  /** Newest-first is wrong here: ordered earliest-first, parent leading. */
  callers: CardPerson[];
  /** The `market_calls.id` a relay must point at. Null before the migration. */
  primaryCall: number | null;
  primaryCaller: CardPerson | null;
  /** What the primary caller held when they asked. Null if they hold no side. */
  primaryCallerSide: Side | null;
  respondedAtMs: number | null;
  respondedSide: Side | null;
}

export interface Outgoing {
  challengeId: number;
  /** Recipient OPPORTUNITIES on this branch — never called "people". */
  reached: number;
  /** Unique confirmed responders. */
  showedUp: number;
  passed: number;
  waiting: number;
  /** Newest first. Passers can never appear here — not anonymised, absent. */
  responders: CardResponder[];
  /** Unique people who put this question in front of their OWN people. */
  relayers: CardRelayer[];
  /** Opportunities created by those relays. Tables, not people. */
  relayReach: number;
  closedAtMs: number | null;
}

export interface ViewerFacts {
  /** Whether a relay is possible RIGHT NOW — canonical, never re-derived here. */
  canRelay: boolean;
  /** The audience a relay would reach. Zero when `canRelay` is false. */
  relayAudience: number;
  /**
   * THE ONE NAME THE RELAY BUTTON MAY USE, and it comes from the AUDIENCE.
   *
   * Null unless the audience is exactly one person with a resolved profile. It
   * exists so this surface can call the SAME `challengeLabel` the closing screen
   * uses instead of inventing a second labelling rule — the durable card was
   * rendering "Challenge all 1" and "Challenge all 2" where the canonical rules
   * say "Challenge Maya" and "Challenge both".
   */
  relayRecipientName: string | null;
  capacity: { active: number; total: number };
}

export interface ChallengeCardProjection {
  marketId: number;
  question: string;
  /** Null when nobody brought this viewer in — an outgoing-only card. */
  incoming: Incoming | null;
  /** Null when the viewer has not put this question up. */
  outgoing: Outgoing | null;
  viewer: ViewerFacts;
  lineage: { startedBy: string | null; through: string | null; depth: number };
  /** The market itself ended. Live obligations stop; history survives. */
  marketClosed: boolean;
  state: CardState;
}

/** The union is closed. A new state lands here as a type error. */
function assertNever(x: never): never {
  throw new Error(`unhandled card state: ${JSON.stringify(x)}`);
}

/**
 * WHICH STATE THIS CARD IS IN — decided once, from facts, in one place.
 *
 * A CLOSED MARKET IS TERMINAL BEFORE ANYTHING ELSE. Once the question is
 * resolved nobody is waiting on anybody: a card still asking would be inviting
 * an answer that can no longer be recorded, and the recipients who never
 * answered must NOT become passers — they ran out of time, which is not a
 * decision they made.
 */
export function cardStateFor(p: Omit<ChallengeCardProjection, "state">): CardState {
  if (p.marketClosed) return "finished";

  const out = p.outgoing;
  if (out) {
    /**
     * TERMINAL BEFORE NEWS, AND THIS ORDER WAS WRONG.
     *
     * The live states are ranked by what is newest — a relay outranks a
     * response, a response outranks a quiet branch — and `finished` was ranked
     * with them. It is not news; it is the end of the lifecycle, and putting it
     * third meant `showedUp > 0` swallowed it.
     *
     * THE VISIBLE COST: "Everyone showed up" was unreachable. Reaching it needs
     * `finished` AND `showedUp >= reached`, but any Challenge with a single
     * responder took `people_showing_up` first — including one that auto-closed
     * precisely BECAUSE everybody answered. The best outcome this system can
     * produce had copy written for it that no state could arrive at, and a
     * Challenge the creator took down went on reading as live.
     *
     * Found while summarising this projection for the Markets page: the summary
     * asked for the completion sentence and the state machine could not produce
     * one.
     */
    if (out.closedAtMs != null || (out.reached > 0 && out.waiting === 0)) return "finished";
    // Somebody carried it further. The largest thing that can happen to a
    // question you put up, so it outranks answers to it.
    if (out.relayers.length > 0) return "chain_moving";
    if (out.showedUp > 0) return "people_showing_up";
    if (out.reached > 0) return "branch_live";
  }

  if (p.incoming?.respondedAtMs != null) return "showed_up";
  if (p.incoming) return "waiting";
  // An outgoing row that reached nobody and a card with no sides at all are the
  // same thing to a reader: nothing is asked and nothing is owed.
  return "finished";
}

/**
 * WHICH STATES BELONG ON THE CURRENT RAIL — the live social loop, and only it.
 *
 * The rail is where a reader ACTS: a question waiting on them, one of theirs that
 * is still gathering answers, a chain still moving. The two terminal states are
 * the record of what already happened — `showed_up` is an answer they have
 * already given, `finished` is a Challenge that has run its course — and both
 * belong in Past Challenges, not in a column somebody has to keep watching. An
 * outcome asks for nothing, so badging it beside live requests would turn the
 * payoff into another chore, which is the exact confusion this split removes.
 *
 * ONE PREDICATE, SO THE TWO SURFACES CANNOT DISAGREE. The panel keeps what this
 * admits; the history keeps the rest. If the boundary lived in two places a card
 * could show up in both, or in neither.
 */
export const LIVE_CARD_STATES: ReadonlySet<CardState> = new Set([
  "waiting",
  "branch_live",
  "people_showing_up",
  "chain_moving",
]);

export function isLiveCard(state: CardState): boolean {
  return LIVE_CARD_STATES.has(state);
}

/* ── Copy. Baseline only — rotation is a later phase, deliberately. ───────── */

/** "Maya brought you in" / "Maya + 2 others brought you in". */
export function broughtYouIn(callers: readonly CardPerson[]): string | null {
  const names = callers.map((c) => c.name.trim()).filter(Boolean);
  if (names.length === 0) return null;
  if (names.length === 1) return `${names[0]} brought you in`;
  return `${names[0]} + ${names.length - 1} other${names.length > 2 ? "s" : ""} brought you in`;
}

/**
 * "You showed up for Maya" / "You showed up for 3 people".
 *
 * SIDE-BLIND, ALWAYS. Identical whether the reader agreed or not — the side is
 * a separate sentence. A Rival who turns up turned up.
 */
export function youShowedUpFor(callers: readonly CardPerson[]): string | null {
  const names = callers.map((c) => c.name.trim()).filter(Boolean);
  if (names.length === 0) return null;
  return names.length === 1
    ? `You showed up for ${names[0]}`
    : `You showed up for ${names.length} people`;
}

/**
 * "Casey showed up" / "3 of your people showed up".
 *
 * THE HEADLINE NEVER CHANGES WITH AGREEMENT. Whether Casey backed the same side
 * or the opposite one, the fact being celebrated is that they answered — and a
 * headline that read differently for a Rival would make Showing Up quietly
 * become Showing Up And Agreeing, which is the one thing it must never mean.
 */
export function responseHeadline(responders: readonly CardResponder[]): string | null {
  const names = responders.map((r) => r.name.trim()).filter(Boolean);
  if (names.length === 0) return null;
  if (names.length === 1) return `${names[0]} showed up`;
  return `${names.length} of your people showed up`;
}

/**
 * "Casey backed NO." / "Casey backed YES with you." / "Casey went NO."
 *
 * The AGREEMENT lives here, one line below the headline, and only when both
 * sides are known. `with you` and `went` are the two halves of the same fact
 * said warmly and neutrally — never "against you", which would make a Rival's
 * answer read as an attack rather than the most interesting thing on the card.
 */
export function responseSideLine(
  responder: Pick<CardResponder, "name" | "side">,
  viewerSide: Side | null,
): string | null {
  const who = responder.name.trim();
  if (!who || !responder.side) return null;
  if (!viewerSide) return `${who} backed ${responder.side}.`;
  return responder.side === viewerSide
    ? `${who} backed ${responder.side} with you.`
    : `${who} went ${responder.side}.`;
}

/**
 * "3 of 13 showed up · 12 waiting" — and a passer is COUNTED, never named.
 *
 * `passed` appears only once somebody has actually passed, because a standing
 * "0 passed" invites the reader to watch a rejection counter that is usually
 * empty. Waiting is dropped at zero for the same reason.
 */
export function progressLine(
  o: Pick<Outgoing, "reached" | "showedUp" | "passed" | "waiting">,
): string | null {
  if (o.reached <= 0) return null;
  const parts = [`${o.showedUp} of ${o.reached} showed up`];
  if (o.waiting > 0) parts.push(`${o.waiting} waiting`);
  if (o.passed > 0) parts.push(`${o.passed} passed`);
  return parts.join(" · ");
}

/**
 * "The question is now on 13 more tables."
 *
 * TABLES, NOT PEOPLE, and that is the whole reason this function exists rather
 * than a template at the call site. `reached` counts recipient OPPORTUNITIES,
 * and once a chain forks the same person can hold two of them. "13 more people"
 * would be a claim the ledger cannot support; "13 more tables" is exactly true.
 */
export function tablesLine(reached: number): string | null {
  if (reached <= 0) return null;
  return `The question is now on ${reached} more table${reached === 1 ? "" : "s"}.`;
}

/**
 * "Casey kept it moving" / "3 people kept it moving."
 *
 * BOTH OF THESE COUNT PEOPLE, so both dedupe HERE rather than trusting whatever
 * the caller happened to hold. `relayers` is a list of ACTS, and one person who
 * re-issued twice must never read as two — the dedupe living inside these two
 * functions is what makes that impossible to forget at a call site.
 */
export function keptItMovingHeadline(relayers: readonly CardRelayer[]): string | null {
  const names = relayPeople(relayers)
    .map((r) => r.name.trim())
    .filter(Boolean);
  if (names.length === 0) return null;
  return names.length === 1 ? `${names[0]} kept it moving` : "Your Challenge is traveling";
}

export function keptItMovingLine(
  relayers: readonly CardRelayer[],
  relayReach: number,
): string | null {
  const people = relayPeople(relayers);
  if (people.length === 0) return null;
  // One PERSON, so the branch total is theirs — however many times they issued.
  if (people.length === 1) return tablesLine(relayReach);
  return `${people.length} people kept it moving.`;
}

/**
 * HOW IT ENDED — and the empty case carries no shame.
 *
 * "Quiet one. Not every question finds its people." is doing real work: a
 * creator who asked eleven people and heard nothing is the most likely person
 * to stop using the product, and a card that reads as a scoreboard they lost is
 * how that happens. Nobody failed. The question did not land, which is a fact
 * about a question.
 */
export interface Completion {
  headline: string;
  support: string | null;
}

export function completionFor(o: Pick<Outgoing, "reached" | "showedUp">): Completion {
  if (o.reached <= 0) return { headline: "Off the table", support: "One Challenge spot opened." };
  if (o.showedUp === 0)
    return { headline: "Quiet one", support: "Not every question finds its people." };
  if (o.showedUp >= o.reached) return { headline: "Everyone showed up", support: null };
  return {
    headline: "Your Challenge is complete",
    support: `${o.showedUp} of ${o.reached} showed up.`,
  };
}

export const REMOVED_HEADLINE = "Off the table";
export const REMOVED_SUPPORT = "One Challenge spot opened.";
export const MARKET_CLOSED_HEADLINE = "The market closed";
export const MARKET_CLOSED_SUPPORT = "The chain remains in your history.";
export const RELAY_TITLE = "Keep the chain moving";

/** "13 of your people haven't answered." */
export function relayInvitation(audience: number): string | null {
  if (audience <= 0) return null;
  return `${audience} of your people haven't answered.`;
}

/**
 * WHERE THIS CAME FROM — one line, and only what can be walked.
 *
 * "3 links deep" is derived from the pointer chain rather than stored, so it
 * cannot disagree with the lineage it describes.
 */
export function lineageLine(l: ChallengeCardProjection["lineage"]): string | null {
  const parts: string[] = [];
  if (l.startedBy) parts.push(`Started by ${l.startedBy}`);
  if (l.through && l.through !== l.startedBy) parts.push(`reached you through ${l.through}`);
  if (l.depth > 1) parts.push(`${l.depth} links deep`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * THE WORDS THIS SURFACE MUST NEVER USE.
 *
 * `joined` and `members` describe an audience rather than people who answered a
 * question. `withdrew` and `cancelled` describe removal as something done TO the
 * recipients, when the rule is that nobody is notified and nobody becomes a
 * passer. And the rejection vocabulary is banned for the reason it has always
 * been: a creator sees a count, never a name.
 */
export const CARD_BANNED_WORDS: readonly string[] = [
  "joined",
  "members",
  "withdrew",
  "cancelled",
  "canceled",
  "rejected",
  "declined",
  "ignored",
  "notified",
  "against you",
  "failed to",
];

/** Everything a fully-resolved card is allowed to say, for the banned-word gate. */
export function cardVocabulary(p: ChallengeCardProjection): string {
  const said: (string | null)[] = [
    p.incoming && broughtYouIn(p.incoming.callers),
    p.incoming && youShowedUpFor(p.incoming.callers),
    p.outgoing && responseHeadline(p.outgoing.responders),
    p.outgoing && progressLine(p.outgoing),
    p.outgoing && tablesLine(p.outgoing.reached),
    p.outgoing && keptItMovingHeadline(p.outgoing.relayers),
    p.outgoing && keptItMovingLine(p.outgoing.relayers, p.outgoing.relayReach),
    p.outgoing && completionFor(p.outgoing).headline,
    p.outgoing && completionFor(p.outgoing).support,
    relayInvitation(p.viewer.relayAudience),
    lineageLine(p.lineage),
    p.marketClosed ? `${MARKET_CLOSED_HEADLINE} ${MARKET_CLOSED_SUPPORT}` : null,
  ];
  return said.filter(Boolean).join(" ");
}

/** Re-exported so a caller never reaches past this module for the shape. */
export { assertNever as assertNeverCardState };
