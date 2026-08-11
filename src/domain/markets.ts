/**
 * MARKETS — the two roles a person can have in a question, and nothing else.
 *
 * THE TAB WAS CALLED POSITIONS AND THAT WAS THE PROBLEM. A position is what you
 * hold; it has no room for the question you WROTE and never backed, and no way
 * to say that authoring outranks holding. So a creator who also bought appeared
 * as a believer in their own market, and the most consequential thing about them
 * — that the question exists because of them — was the one fact the page could
 * not state.
 *
 *   MARKET MAKER   you created it. First, always, and never duplicated below.
 *   BELIEVER       somebody else created it and you hold a position.
 *
 * THE PARTITION IS EXCLUSIVE BY CONSTRUCTION. `partitionMarkets` returns two
 * arrays from one pass and cannot place a market in both, so "created and held
 * appears once" is not a rule a component has to remember.
 *
 * THIS MODULE CONSUMES CANONICAL STATE AND OWNS NONE OF IT. Challenge lifecycle,
 * audience, recipient counts, showed-up counts, lineage, removal — all of it
 * arrives as a `ChallengeCardProjection` and is SUMMARISED here for a card.
 * Nothing below recounts a responder or re-derives a state; if a summary needs a
 * fact the projection does not carry, the fact belongs in the projection.
 *
 * UNKNOWN IS NOT ZERO, on every field. An unsettled balance is not an exit, a
 * failed activity read is not a quiet market, and a missing Challenge projection
 * is not the absence of a Challenge. Each of those has a distinct representation
 * below and a sentence that weakens rather than a claim that hardens.
 *
 * ZERO IO, pure, fully testable.
 */
import type { Side } from "@/domain/post-action";
import {
  completionFor,
  keptItMovingHeadline,
  progressLine,
  tablesLine,
  type ChallengeCardProjection,
} from "@/domain/challenge-card";

export type Ownership = "market_maker" | "believer";

/**
 * WHAT THEY HOLD, OR THAT WE DO NOT KNOW.
 *
 * Null is a third state and never collapses into `{ yes: 0, no: 0 }` — the same
 * rule the post-action screen enforces, for the same reason: zero holdings is
 * the claim "they are out", and an unsettled read must not make it.
 */
export type Holding = { yes: number; no: number } | null;

/** Which way they are pointed. Null when they hold nothing, or nothing known. */
export function heldSide(h: Holding): Side | "BOTH" | null {
  if (!h) return null;
  if (h.yes > 0 && h.no > 0) return "BOTH";
  if (h.yes > 0) return "YES";
  if (h.no > 0) return "NO";
  return null;
}

/**
 * THE IDENTITY LINE, and a Market Maker is never reduced to a believer.
 *
 * Authorship is permanent and a position is not, so somebody who wrote the
 * question and then backed it reads "MARKET MAKER · BACKING YES" — both facts,
 * in the order that matters. A creator who holds nothing is still a Market
 * Maker; the badge simply stops naming a side.
 */
export function identityLabel(ownership: Ownership, holding: Holding): string {
  const side = heldSide(holding);
  if (ownership === "market_maker") {
    if (side === "BOTH") return "MARKET MAKER · HOLDING BOTH SIDES";
    return side ? `MARKET MAKER · BACKING ${side}` : "MARKET MAKER";
  }
  if (side === "BOTH") return "BELIEVER · BOTH SIDES";
  /**
   * A BELIEVER WITH NO KNOWN SIDE IS STILL A BELIEVER. They are in this list
   * because the position engine has processed trades for them here; an unsettled
   * balance read must not silently demote them or invent a direction.
   */
  return side ? `BELIEVER · ${side}` : "BELIEVER";
}

/**
 * HOW MANY PEOPLE ARE IN THIS QUESTION — or that the read did not complete.
 *
 * Null is not zero. "18 believers" and silence are both honest; "0 believers"
 * from a failed count is a claim about a market nobody looked at.
 */
export interface Participation {
  believers: number | null;
  yes: number | null;
  no: number | null;
}

export function believersLine(p: Participation): string | null {
  if (p.believers == null || p.believers <= 0) return null;
  return `${p.believers} believer${p.believers === 1 ? "" : "s"}`;
}

/**
 * THE LATEST THING A HUMAN DID HERE.
 *
 * A market row, not an event stream — one line, already composed by whatever
 * canonical source produced it. `null` means the activity read did not complete
 * OR nothing has happened, and the card says nothing either way rather than
 * printing "no activity", which is a claim only the first case supports.
 */
export interface LatestEvent {
  line: string;
  atMs: number;
}

export interface MarketEntry {
  marketId: number;
  question: string;
  ownership: Ownership;
  holding: Holding;
  participation: Participation;
  latest: LatestEvent | null;
  /** The canonical Challenge state for this viewer and market. Null when none. */
  challenge: ChallengeCardProjection | null;
  /** Creator earnings, in USD. Secondary on the card, and null when unknown. */
  earningsUsd: number | null;
  createdAtMs: number;
}

/**
 * ONE MARKET, ONE SECTION. Created-and-held lands under Market Maker only.
 *
 * Returned as two arrays from one pass rather than two filters over the same
 * list, because two filters is where a market ends up in both: the second
 * predicate has to remember to exclude what the first one took, and one day it
 * will not.
 */
export function partitionMarkets(entries: readonly MarketEntry[]): {
  makers: MarketEntry[];
  believers: MarketEntry[];
} {
  const makers: MarketEntry[] = [];
  const believers: MarketEntry[] = [];
  for (const e of entries) (e.ownership === "market_maker" ? makers : believers).push(e);
  return { makers, believers };
}

/**
 * WHAT IS HAPPENING AROUND THIS QUESTION — summarised from canonical state.
 *
 * Every branch reads the projection's settled `state`. Nothing here counts a
 * responder, compares a fraction or decides whether a Challenge is finished;
 * that work already happened, once, in `challengeCardsFor`.
 *
 * A NULL PROJECTION IS NOT "NO CHALLENGE". It is a read that did not complete or
 * a market the reader has no Challenge relationship with, and the card
 * distinguishes them by saying nothing rather than "no active Challenge".
 */
export function challengeSummary(c: ChallengeCardProjection | null): string | null {
  if (!c) return null;
  const out = c.outgoing;
  switch (c.state) {
    case "people_showing_up":
      return out && progressLine(out) ? `Challenge: ${progressLine(out)}` : null;
    case "chain_moving": {
      const who = out && keptItMovingHeadline(out.relayers);
      return who ? `Challenge: ${who.toLowerCase()}.` : null;
    }
    case "branch_live":
      return out && tablesLine(out.reached) ? `Challenge: ${tablesLine(out.reached)}` : null;
    case "finished": {
      if (!out) return null;
      const done = completionFor(out);
      return done.support
        ? `Challenge: ${done.support}`
        : `Challenge: ${done.headline.toLowerCase()}.`;
    }
    case "waiting":
    case "showed_up":
      /**
       * THE INCOMING SIDE IS NOT THIS PAGE'S JOB. Markets summarises what is
       * happening around a question the reader owns or holds; being asked by
       * somebody else is the Challenge rail's subject, and repeating it here
       * would put the same relationship on two surfaces again.
       */
      return null;
    default: {
      const never: never = c.state;
      throw new Error(`unhandled card state: ${String(never)}`);
    }
  }
}

/**
 * "Latest: Maya backed YES." — and absent whenever there is nothing provable.
 */
export function latestLine(e: LatestEvent | null): string | null {
  return e?.line ? `Latest: ${e.line}` : null;
}

/**
 * EARNINGS, LAST AND QUIET.
 *
 * A Market Maker card answers "what is happening around the question I created",
 * and a number at the top would answer a different question the reader did not
 * ask. Null when unknown — an unread balance is not zero earnings.
 */
export function earningsLine(usd: number | null): string | null {
  if (usd == null || usd === 0) return null;
  const sign = usd > 0 ? "+" : "−";
  return `${sign}$${Math.abs(usd).toFixed(2)} creator earnings`;
}

/**
 * WHAT PUTS A MAKER'S MARKET AT THE TOP — human activity, never money.
 *
 * The order is the brief's, and each rung is a person doing something: somebody
 * answered, somebody carried it further, somebody traded. Creation recency is
 * last because it is the only one that is not news.
 *
 * NOTHING HERE IS "UNREAD". There is no persisted last-seen model, so a card
 * cannot honestly claim the reader has not seen something — it can only say what
 * happened most recently.
 */
export function makerRank(e: MarketEntry): number {
  const s = e.challenge?.state;
  if (s === "people_showing_up") return 5;
  if (s === "chain_moving") return 4;
  if (e.latest) return 3;
  if (s === "branch_live") return 2;
  return 1;
}

export function sortMakers(entries: readonly MarketEntry[]): MarketEntry[] {
  return [...entries].sort(
    (a, b) =>
      makerRank(b) - makerRank(a) ||
      (b.latest?.atMs ?? 0) - (a.latest?.atMs ?? 0) ||
      b.createdAtMs - a.createdAtMs ||
      a.marketId - b.marketId,
  );
}

/** Believer markets lead with whatever moved most recently. */
export function sortBelievers(entries: readonly MarketEntry[]): MarketEntry[] {
  return [...entries].sort(
    (a, b) =>
      (b.latest?.atMs ?? 0) - (a.latest?.atMs ?? 0) ||
      b.createdAtMs - a.createdAtMs ||
      a.marketId - b.marketId,
  );
}

export const MAKER_TITLE = "Market Maker";
export const BELIEVER_TITLE = "Believer";
export const MARKETS_TAB = "Markets";

/**
 * WORDS THIS PAGE MUST NEVER USE.
 *
 * `portfolio`, `holdings` and `P&L` would make it the financial dashboard the
 * brief refuses — the Market Maker card exists to answer what is happening
 * around a question, and money is the last line for a reason. The rest are the
 * standing Challenge bans, which apply on every surface that speaks about
 * Challenges rather than only on the ones that create them.
 */
export const MARKETS_BANNED_WORDS: readonly string[] = [
  "portfolio",
  "p&l",
  "unrealized",
  "accepted",
  "invited",
  "invite",
  "credits",
  "tokens",
  "allowance",
  "streak",
  "no activity",
  "no active challenge",
];

/** Everything one card can say, for the banned-word gate. */
export function cardVocabulary(e: MarketEntry): string {
  return [
    identityLabel(e.ownership, e.holding),
    e.question,
    believersLine(e.participation),
    latestLine(e.latest),
    challengeSummary(e.challenge),
    earningsLine(e.earningsUsd),
  ]
    .filter(Boolean)
    .join(" · ");
}
