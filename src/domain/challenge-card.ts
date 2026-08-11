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
  relayers: CardPerson[];
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
    // Somebody carried it further. The largest thing that can happen to a
    // question you put up, so it outranks answers to it.
    if (out.relayers.length > 0) return "chain_moving";
    if (out.showedUp > 0) return "people_showing_up";
    // Everybody terminal, or the creator took it down.
    if (out.closedAtMs != null || (out.reached > 0 && out.waiting === 0)) return "finished";
    if (out.reached > 0) return "branch_live";
  }

  if (p.incoming?.respondedAtMs != null) return "showed_up";
  if (p.incoming) return "waiting";
  // An outgoing row that reached nobody and a card with no sides at all are the
  // same thing to a reader: nothing is asked and nothing is owed.
  return "finished";
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

/** "Casey kept it moving" / "3 people kept it moving." */
export function keptItMovingHeadline(relayers: readonly CardPerson[]): string | null {
  const names = relayers.map((r) => r.name.trim()).filter(Boolean);
  if (names.length === 0) return null;
  return names.length === 1 ? `${names[0]} kept it moving` : "Your Challenge is traveling";
}

export function keptItMovingLine(
  relayers: readonly CardPerson[],
  relayReach: number,
): string | null {
  if (relayers.length === 0) return null;
  if (relayers.length === 1) return tablesLine(relayReach);
  return `${relayers.length} people kept it moving.`;
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
