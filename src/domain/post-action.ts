/**
 * WHAT HAPPENS AFTER A CONFIRMED ACTION — decided once, for every branch.
 *
 * THE PROBLEM THIS EXISTS TO END. The moment after a trade was owned by four
 * things at once: `ConvictionReveal` chose the personal story, `LaunchRail`
 * decided whether anybody had been answered, `KeepChainMoving` decided whether
 * to offer a relay, and the route decided where "done" went. None of them could
 * see the others, so the screen was assembled by whichever component happened to
 * render — and a state nobody had thought about (sold out while a Challenge was
 * live; answered a call in a market already on your table) produced whatever
 * fell out.
 *
 * So the decision moves here, ONCE, as a total function over a discriminated
 * union. Every branch is enumerated and `assertNever` makes a new action a
 * COMPILE error rather than a silent default. A component's job is to render
 * what this returns, never to work out what it should be.
 *
 * WHAT THIS DOES NOT DO. It does not write the personal story — `conviction-reveal`
 * still owns that, and it is better at it. This decides whether the personal
 * story is what the reader should be shown AT ALL, because a social consequence
 * ("you showed up for Maya") outranks "you're early", and only something that can
 * see both can say so.
 *
 * ZERO IO, pure, fully testable — which is the point. Every scenario in the
 * brief is a case in a table rather than a screen somebody has to reproduce.
 */

export type Side = "YES" | "NO";

/** What the person just did. Adding one here breaks every switch until handled. */
export type PostAction =
  | "create_market"
  | "first_buy"
  | "buy_more"
  | "buy_opposite_side"
  | "partial_sell"
  | "side_exit"
  | "market_exit";

/** Their standing in THIS market, which decides whose screen this is. */
export type MarketRole = "market_maker" | "believer" | "market_maker_and_believer";

/**
 * Whether an audience could be read at all.
 *
 * `failed` IS NOT `none`, and conflating them is the failure this codebase keeps
 * paying for: a blocked read rendered as "nobody qualifies" is a confident,
 * welcoming, wrong statement about somebody's network. `loading` is separate
 * again — the personal story paints first and the social module arrives after.
 */
export type AudienceStatus = "loading" | "available" | "none" | "failed";

/** What the viewer already has on this market. */
export type OutgoingState = "none" | "live" | "completed" | "removed";

export interface Holdings {
  yes: number;
  no: number;
}

export interface PostActionInput {
  action: PostAction;
  role: MarketRole;
  /** The side acted on. Null for a creation with no seeded position. */
  side: Side | null;
  before: Holdings;
  /**
   * AFTER, AND WHETHER WE ACTUALLY KNOW IT.
   *
   * A sell must never claim "you're out" or "you took some off" from a balance
   * the indexer has not confirmed. When `afterKnown` is false the screen says
   * the position is updating and stops — guessing here is how somebody who
   * still holds $40 gets told they left.
   */
  after: Holdings;
  afterKnown: boolean;
  /** How many incoming calls this action answered. Zero means organic. */
  answeredCallers: number;
  /** The canonical primary caller — earliest still-active call. */
  primaryCallerName: string | null;
  outgoing: OutgoingState;
  capacity: { active: number; total: number };
  audience: { status: AudienceStatus; total: number };
  /** Somebody else still waiting, for the fallback after this screen. */
  nextIncoming: { name: string } | null;
  /** Canonical realised P&L. Null means proceeds may NEVER be called profit. */
  realizedGainUsd: number | null;
  proceedsUsd: number | null;
  /** What the remaining position is worth, when it is known. */
  remainingValueUsd: number | null;
}

export type CtaKind =
  | "challenge"
  | "make_room"
  | "next_question"
  | "back_to_market"
  | "view_market"
  | "answer";

export interface Cta {
  kind: CtaKind;
  label: string;
}

/** At most one consequence block. Never two. */
export type Consequence = "reveal" | "branch_live" | "challenge_live" | null;

/** At most one social module, and `make_room` is one of its shapes. */
export type ChallengeModule = "relay" | "organic" | "make_room" | null;

/**
 * Which family of copy the hook came from. Reported so the analytics can say
 * what was shown without the component having to guess, and so the rotation in
 * §9 has something stable to key on.
 */
export type CopyCategory =
  | "reciprocity"
  | "market_maker"
  | "first_or_early"
  | "chain"
  | "tribe_rivals"
  | "still_forming"
  | "general"
  | "exit";

export interface PostActionExperience {
  headline: string;
  support: string | null;
  consequence: Consequence;
  challengeModule: ChallengeModule;
  primary: Cta;
  secondary: Cta | null;
  /** A sell never leaves the market it happened in. */
  stayOnMarket: boolean;
  copyCategory: CopyCategory;
}

/** The union is closed. A new action lands here as a type error. */
function assertNever(x: never): never {
  throw new Error(`unhandled post action: ${JSON.stringify(x)}`);
}

const held = (h: Holdings): boolean => h.yes > 0 || h.no > 0;
const spotsOpen = (c: { active: number; total: number }): number =>
  Math.max(0, c.total - Math.max(0, c.active));

/** Money the reader can check. Never rounded into a claim. */
const usd = (v: number): string => `$${Math.abs(v).toFixed(2)}`;

/**
 * CAN THIS PERSON PUT THE QUESTION UP RIGHT NOW?
 *
 * `loading` and `failed` both answer NO, and both do it silently: the module is
 * simply absent rather than rendered empty or rendered as an error. A social
 * offer is an enhancement, and an enhancement that cannot be made is one the
 * reader should never learn was attempted.
 */
function canOffer(i: PostActionInput): boolean {
  return i.audience.status === "available" && i.audience.total > 0 && i.outgoing !== "live";
}

/** "Challenge all 13" / "Challenge Maya" / "Challenge both" — §9's CTA rules. */
export function challengeLabel(total: number, onlyName?: string | null): string {
  if (total === 1) return onlyName?.trim() ? `Challenge ${onlyName.trim()}` : "Challenge all 1";
  if (total === 2) return "Challenge both";
  return `Challenge all ${total}`;
}

/**
 * THE ONE NEXT ACTION, chosen by §21's hierarchy and nothing else.
 *
 * The order is not cosmetic. Offering the chain first is what makes this a relay
 * rather than a receipt; "Make room" before "Next Question" is what stops a full
 * table silently swallowing the one moment somebody wanted to ask; and a waiting
 * caller outranks a generic next question because a person is waiting on a human
 * answer rather than on engagement.
 *
 * NOTHING HERE IS EVER RENDERED DISABLED. A CTA that cannot be used is a smaller
 * version of a promise that cannot be kept, so each branch returns the strongest
 * action that is actually available.
 */
function nextForBuy(i: PostActionInput): { primary: Cta; module: ChallengeModule } {
  if (canOffer(i) && spotsOpen(i.capacity) > 0) {
    return {
      primary: {
        kind: "challenge",
        label: challengeLabel(i.audience.total, i.primaryCallerName),
      },
      module: i.answeredCallers > 0 ? "relay" : "organic",
    };
  }
  if (canOffer(i) && spotsOpen(i.capacity) === 0) {
    return { primary: { kind: "make_room", label: "Make room" }, module: "make_room" };
  }
  if (i.nextIncoming?.name.trim()) {
    return {
      primary: { kind: "answer", label: `Answer ${i.nextIncoming.name.trim()}` },
      module: null,
    };
  }
  return { primary: { kind: "next_question", label: "Next Question" }, module: null };
}

/**
 * WHAT A SELL IS ALLOWED TO SAY ABOUT MONEY.
 *
 * Proceeds are what came back; a gain is what was made. They are different
 * numbers and only one of them is a claim about whether the trade was good.
 * With no canonical realised P&L the sentence says "returned" and stops —
 * calling proceeds profit is the single most tempting lie on this screen.
 */
function sellSupport(i: PostActionInput, leftSide: Side | null): string | null {
  const parts: string[] = [];
  if (leftSide) parts.push(`Closed ${leftSide}.`);
  if (i.proceedsUsd != null && i.proceedsUsd > 0) parts.push(`${usd(i.proceedsUsd)} returned.`);
  return parts.length > 0 ? parts.join(" ") : null;
}

/** The realised line, and ONLY when the canonical number exists. */
export function realizedLine(realizedGainUsd: number | null): string | null {
  if (realizedGainUsd == null || realizedGainUsd === 0) return null;
  return `${realizedGainUsd > 0 ? "+" : "−"}${usd(realizedGainUsd)} realized`;
}

/**
 * THE POST-ACTION SCREEN, resolved.
 *
 * Headline priority follows §5: an answered call outranks being a Market Maker,
 * which outranks being first, which outranks everything the personal reveal
 * could say. `consequence: "reveal"` is how this hands the story back to
 * `conviction-reveal` — it says "the personal story wins here", it does not try
 * to write one.
 */
export function resolvePostAction(i: PostActionInput): PostActionExperience {
  switch (i.action) {
    case "create_market": {
      const { primary, module } = nextForBuy(i);
      return {
        headline: "Your market is live.",
        support: i.side ? `You're backing ${i.side}.` : null,
        consequence: null,
        // A creation offers the question to people; it never "relays", because
        // nobody brought the creator in.
        challengeModule: module === "relay" ? "organic" : module,
        primary:
          primary.kind === "next_question"
            ? { kind: "view_market", label: "View Market" }
            : primary,
        secondary: { kind: "view_market", label: "View Market" },
        stayOnMarket: true,
        copyCategory: "market_maker",
      };
    }

    case "first_buy":
    case "buy_more":
    case "buy_opposite_side": {
      const { primary, module } = nextForBuy(i);
      const secondary: Cta | null =
        primary.kind === "next_question" ? null : { kind: "next_question", label: "Next Question" };

      /**
       * SOMEBODY ASKED, AND YOU ANSWERED — the strongest thing this screen can
       * say, and it outranks every personal fact including being first.
       *
       * SIDE-BLIND HEADLINE, ALWAYS. "You showed up for Maya" is identical
       * whether the reader agreed with Maya or not; the side is a separate
       * sentence. A Rival who turns up turned up.
       */
      if (i.answeredCallers > 0) {
        const who =
          i.answeredCallers === 1 && i.primaryCallerName?.trim()
            ? `You showed up for ${i.primaryCallerName.trim()}.`
            : `You showed up for ${i.answeredCallers} people.`;
        return {
          headline: who,
          support: i.side ? `You backed ${i.side}.` : null,
          // Already asked their people about this one — say so instead of
          // offering a second Challenge for the same market.
          consequence: i.outgoing === "live" ? "branch_live" : null,
          challengeModule: module,
          primary,
          secondary,
          stayOnMarket: false,
          copyCategory: "reciprocity",
        };
      }

      /**
       * BOTH SIDES HELD IS NOT A CHANGE OF MIND. Only a proven transition — the
       * original side gone — may be called a flip, and that is `market_exit` or
       * `side_exit` territory, not this.
       */
      if (i.action === "buy_opposite_side" && i.after.yes > 0 && i.after.no > 0) {
        return {
          headline: i.side ? `You added ${i.side}.` : "You added the other side.",
          support: "You now hold both sides.",
          consequence: null,
          challengeModule: module,
          primary,
          secondary,
          stayOnMarket: false,
          // Neutral on purpose: "see who stands with you" is the wrong sentence
          // for somebody holding both sides.
          copyCategory: "general",
        };
      }

      if (i.action === "buy_more") {
        return {
          headline: i.side ? `You added to ${i.side}.` : "Your conviction grew.",
          support: null,
          consequence: i.outgoing === "live" ? "branch_live" : null,
          challengeModule: module,
          primary,
          secondary,
          stayOnMarket: false,
          copyCategory: "general",
        };
      }

      // A creator backing their own question stays a Market Maker first.
      if (i.role !== "believer") {
        return {
          headline: "You made the question. Now you're in.",
          support: i.side ? `You're backing ${i.side}.` : null,
          consequence: null,
          challengeModule: module,
          primary,
          secondary,
          stayOnMarket: false,
          copyCategory: "market_maker",
        };
      }

      /**
       * ORGANIC FIRST BUY — the personal story wins, and this says so rather
       * than writing one. `conviction-reveal` already knows whether they were
       * first, early, or surprised the House.
       */
      return {
        headline: "That's a real call.",
        support: i.side ? `You backed ${i.side}.` : null,
        consequence: "reveal",
        challengeModule: module,
        primary,
        secondary,
        stayOnMarket: false,
        copyCategory: "first_or_early",
      };
    }

    case "partial_sell":
    case "side_exit":
    case "market_exit": {
      /**
       * A SELL NEVER LEAVES THE MARKET, and never offers "Next Question". The
       * reader just changed their position in this question; sending them
       * somewhere else treats the sale as a completed errand rather than a
       * decision they may still be making.
       */
      const backToMarket: Cta = { kind: "back_to_market", label: "Back to Market" };

      /**
       * THE BALANCE READ FAILED. Say what is certainly true — the sale
       * confirmed — and refuse to characterise it. "You're out" to somebody who
       * still holds half their position is worse than saying nothing.
       */
      if (!i.afterKnown) {
        return {
          headline: "Sale confirmed.",
          support: "Your position is updating.",
          consequence: null,
          challengeModule: null,
          primary: backToMarket,
          secondary: null,
          stayOnMarket: true,
          copyCategory: "exit",
        };
      }

      const stillIn = held(i.after);
      const offer = canOffer(i) && spotsOpen(i.capacity) > 0;
      const full = canOffer(i) && spotsOpen(i.capacity) === 0;

      // FULLY OUT.
      if (!stillIn) {
        /**
         * A MARKET MAKER MAY STILL ASK. They are inviting people to answer their
         * QUESTION, not to copy a position — so the offer survives an exit that
         * would silence an ordinary believer, for whom it would read as asking
         * people into something they just left.
         */
        const makerMayAsk = i.role !== "believer";
        return {
          headline: makerMayAsk ? "Your position is closed." : "You're out.",
          support: makerMayAsk ? "Your question is still alive." : sellSupport(i, i.side),
          consequence: i.outgoing === "live" ? "challenge_live" : null,
          challengeModule:
            makerMayAsk && offer ? "organic" : makerMayAsk && full ? "make_room" : null,
          primary:
            makerMayAsk && offer
              ? { kind: "challenge", label: challengeLabel(i.audience.total) }
              : makerMayAsk && full
                ? { kind: "make_room", label: "Make room" }
                : backToMarket,
          secondary: makerMayAsk && (offer || full) ? backToMarket : null,
          stayOnMarket: true,
          copyCategory: makerMayAsk ? "market_maker" : "exit",
        };
      }

      // LEFT ONE SIDE, STILL HOLDS THE OTHER.
      const remaining: Side = i.after.yes > 0 ? "YES" : "NO";
      if (i.action === "side_exit") {
        return {
          headline: i.side ? `You left ${i.side}.` : "You left that side.",
          support:
            i.remainingValueUsd != null
              ? `Still backing ${remaining} with ${usd(i.remainingValueUsd)}.`
              : `Still backing ${remaining}.`,
          consequence: i.outgoing === "live" ? "challenge_live" : null,
          challengeModule: offer ? "organic" : full ? "make_room" : null,
          primary: offer
            ? { kind: "challenge", label: challengeLabel(i.audience.total) }
            : full
              ? { kind: "make_room", label: "Make room" }
              : backToMarket,
          secondary: offer || full ? backToMarket : null,
          stayOnMarket: true,
          copyCategory: "general",
        };
      }

      // TOOK SOME OFF.
      return {
        headline: "You took some off.",
        support:
          i.remainingValueUsd != null
            ? `Still backing ${remaining} with ${usd(i.remainingValueUsd)}.`
            : `Still backing ${remaining}.`,
        consequence: i.outgoing === "live" ? "challenge_live" : null,
        challengeModule: offer ? "organic" : full ? "make_room" : null,
        primary: offer
          ? { kind: "challenge", label: challengeLabel(i.audience.total) }
          : full
            ? { kind: "make_room", label: "Make room" }
            : backToMarket,
        secondary: offer || full ? backToMarket : null,
        stayOnMarket: true,
        copyCategory: "general",
      };
    }

    default:
      return assertNever(i.action);
  }
}

/**
 * Words this screen must never use, whatever the branch.
 *
 * Three families, and each one is a lie of a different kind. The workflow words
 * describe a record changing rather than two people doing something. The
 * delivery words claim a channel this product does not have — there is no push,
 * no email, no inbox, so "notified" is simply false. And the casino words import
 * a reward system this product decided against.
 */
export const POST_ACTION_BANNED: readonly string[] = [
  "accepted",
  "declined",
  "rejected",
  "ignored",
  "notified",
  "delivered",
  "invitation sent",
  "transaction successful",
  "streak",
  "credits",
  "xp",
  "leaderboard",
  "profit",
];
