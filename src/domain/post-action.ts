/**
 * WHAT HAPPENS AFTER A CONFIRMED ACTION — decided once, for every branch.
 *
 * THE PROBLEM THIS EXISTS TO END. The moment after a trade is owned by four
 * things at once: `ConvictionReveal` chooses the personal story, `LaunchRail`
 * decides whether anybody was answered, `KeepChainMoving` decides whether to
 * offer a relay, and the route decides where "done" goes. None can see the
 * others, so the screen is assembled by whichever component happens to render —
 * and a state nobody thought about (sold out while a Challenge was live;
 * answered a call in a market already on your table) produces whatever falls out.
 *
 * THIS MODULE IS THE FOUNDATION FOR ENDING THAT, NOT THE END OF IT. Nothing in
 * production calls it yet. The four owners above still decide the live
 * experience independently, and they will until the wiring PR lands. Until then
 * this is a correct answer nobody is asking for, which is worth saying out loud
 * so the next reader does not assume the problem is solved.
 *
 * WHAT IT DOES NOT DO: write the personal story. `conviction-reveal` owns that
 * and is better at it. This decides whether the personal story should be shown
 * AT ALL — "you showed up for Maya" outranks "you're early", and only something
 * that can see both can say so. `consequence: "reveal"` hands the moment back.
 *
 * THE INPUT IS A DISCRIMINATED UNION, and that is load-bearing rather than
 * tidy. A single wide interface let a create carry answered callers, a sell
 * carry buy-only fields, and a market exit carry remaining holdings — states
 * that cannot exist, silently representable, waiting to be branched on. Each
 * action now admits only the fields it can actually have, so the impossible
 * combinations are compile errors instead of tests nobody wrote.
 *
 * ZERO IO, pure, fully testable.
 */

export type Side = "YES" | "NO";

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

export interface Audience {
  status: AudienceStatus;
  total: number;
  /**
   * THE ONE PERSON THIS WOULD REACH — and it must come from the AUDIENCE.
   *
   * The CTA used to read `primaryCallerName` here, which is a different human
   * entirely: the person who challenged the viewer, not the person the viewer
   * would be challenging. With an audience of one that rendered "Challenge Maya"
   * where Maya had just challenged THEM — naming the wrong side of the
   * relationship on a button that then contacts somebody else.
   *
   * Null until §4's canonical audience supplies it. The label falls back to a
   * sentence that names nobody rather than guessing, because the only thing
   * worse than no name is a confident wrong one.
   */
  singleRecipientName: string | null;
}

/** What the viewer already has on this market. */
export type OutgoingState = "none" | "live" | "completed" | "removed";

export interface Holdings {
  yes: number;
  no: number;
}

/**
 * NOTHING LEFT, EXPRESSED IN THE TYPE.
 *
 * The literal zeroes are the point: a `market_exit` carrying remaining holdings
 * is a contradiction, and now it does not compile rather than reaching a branch
 * that has to decide what it meant.
 */
export interface NoHoldings {
  yes: 0;
  no: 0;
}

/** Everything true regardless of which action happened. */
interface Common {
  role: MarketRole;
  outgoing: OutgoingState;
  capacity: { active: number; total: number };
  audience: Audience;
}

/**
 * WHO WAS ANSWERED. The name is REQUIRED, not optional.
 *
 * With an optional name a count of one fell through to the plural branch and
 * produced "You showed up for 1 people." The type now makes that unreachable:
 * a caller who cannot be named is a caller this product refuses to speak about,
 * and every server path already falls back to a wallet alias rather than null.
 */
export interface AnsweredCalls {
  count: number;
  primaryCallerName: string;
}

export interface CreateMarketInput extends Common {
  action: "create_market";
  /** A creation is authored by definition; `believer` is not a thing here. */
  role: "market_maker" | "market_maker_and_believer";
  /** The seeded position, when the creation also took one. */
  side: Side | null;
}

export interface BuyInput extends Common {
  action: "first_buy" | "buy_more" | "buy_opposite_side";
  /** A buy always has a side. There is no directionless purchase. */
  side: Side;
  after: Holdings;
  /** Null when nobody had asked — an organic buy. */
  answered: AnsweredCalls | null;
  /** Somebody else still waiting, for the fallback after this screen. */
  nextIncoming: { name: string } | null;
}

interface SellCommon extends Common {
  side: Side;
  /** Canonical realised P&L. Null means proceeds may NEVER be called profit. */
  realizedGainUsd: number | null;
  proceedsUsd: number | null;
  remainingValueUsd: number | null;
}

export interface PartialSellInput extends SellCommon {
  action: "partial_sell";
  /** Null when the post-sell balance read failed. Never guessed. */
  after: Holdings | null;
}

export interface SideExitInput extends SellCommon {
  action: "side_exit";
  after: Holdings | null;
}

export interface MarketExitInput extends SellCommon {
  action: "market_exit";
  /** Nothing left, or unknown. Remaining holdings do not typecheck. */
  after: NoHoldings | null;
}

export type SellInput = PartialSellInput | SideExitInput | MarketExitInput;
export type PostActionInput = CreateMarketInput | BuyInput | SellInput;
export type PostAction = PostActionInput["action"];

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
  /** Null whenever it would repeat the primary. Never the same action twice. */
  secondary: Cta | null;
  /** A sell never leaves the market it happened in. */
  stayOnMarket: boolean;
  copyCategory: CopyCategory;
}

/** The union is closed. A new action lands here as a type error. */
function assertNever(x: never): never {
  throw new Error(`unhandled post action: ${JSON.stringify(x)}`);
}

const spotsOpen = (c: { active: number; total: number }): number =>
  Math.max(0, c.total - Math.max(0, c.active));

/** Money the reader can check. Never rounded into a claim. */
const usd = (v: number): string => `$${Math.abs(v).toFixed(2)}`;

/**
 * CAN THIS PERSON PUT THE QUESTION UP RIGHT NOW?
 *
 * `loading` and `failed` both answer NO, and both do it silently: the module is
 * absent rather than rendered empty or rendered as an error. A social offer is
 * an enhancement, and an enhancement that cannot be made is one the reader
 * should never learn was attempted.
 */
function canOffer(i: PostActionInput): boolean {
  return i.audience.status === "available" && i.audience.total > 0 && i.outgoing !== "live";
}

/**
 * "Challenge all 13" / "Challenge Maya" / "Challenge both" / "Challenge them".
 *
 * The name may ONLY come from the audience. At one person with no name the
 * label says "them" — nobody is named, nothing is guessed, and the button still
 * reads like a sentence rather than "Challenge all 1".
 */
export function challengeLabel(audience: Audience): string {
  const only = audience.singleRecipientName?.trim();
  if (audience.total === 1) return only ? `Challenge ${only}` : "Challenge them";
  if (audience.total === 2) return "Challenge both";
  return `Challenge all ${audience.total}`;
}

/** The realised line, and ONLY when the canonical number exists. */
export function realizedLine(realizedGainUsd: number | null): string | null {
  if (realizedGainUsd == null || realizedGainUsd === 0) return null;
  return `${realizedGainUsd > 0 ? "+" : "−"}${usd(realizedGainUsd)} realized`;
}

/**
 * THE ONE NEXT ACTION, chosen by §21's hierarchy and nothing else.
 *
 * The order is not cosmetic. Offering the chain first is what makes this a relay
 * rather than a receipt; "Make room" before "Next Question" stops a full table
 * silently swallowing the one moment somebody wanted to ask; and a waiting
 * caller outranks a generic next question because a person is waiting on a human
 * answer rather than on engagement.
 *
 * NOTHING HERE IS EVER RENDERED DISABLED. A CTA that cannot be used is a smaller
 * version of a promise that cannot be kept, so each branch returns the strongest
 * action that is actually available.
 */
function nextForBuy(i: CreateMarketInput | BuyInput): { primary: Cta; module: ChallengeModule } {
  if (canOffer(i) && spotsOpen(i.capacity) > 0) {
    return {
      primary: { kind: "challenge", label: challengeLabel(i.audience) },
      module: i.action !== "create_market" && i.answered ? "relay" : "organic",
    };
  }
  if (canOffer(i) && spotsOpen(i.capacity) === 0) {
    return { primary: { kind: "make_room", label: "Make room" }, module: "make_room" };
  }
  const waiting = i.action !== "create_market" ? i.nextIncoming?.name.trim() : null;
  if (waiting) return { primary: { kind: "answer", label: `Answer ${waiting}` }, module: null };
  return { primary: { kind: "next_question", label: "Next Question" }, module: null };
}

/**
 * WHAT A SELL IS ALLOWED TO SAY ABOUT MONEY.
 *
 * Proceeds are what came back; a gain is what was made. They are different
 * numbers and only one is a claim about whether the trade was good. With no
 * canonical realised P&L the sentence says "returned" and stops — calling
 * proceeds profit is the single most tempting lie on this screen.
 */
function sellSupport(i: SellInput): string | null {
  const parts = [`Closed ${i.side}.`];
  if (i.proceedsUsd != null && i.proceedsUsd > 0) parts.push(`${usd(i.proceedsUsd)} returned.`);
  return parts.join(" ");
}

/** The still-in sentence, with a value only when there is one. */
function stillBacking(remaining: Side, valueUsd: number | null): string {
  return valueUsd != null
    ? `Still backing ${remaining} with ${usd(valueUsd)}.`
    : `Still backing ${remaining}.`;
}

/**
 * SECONDARY IS NULL WHENEVER IT WOULD REPEAT THE PRIMARY.
 *
 * The create screen returned View Market as BOTH actions whenever there was no
 * audience — one destination rendered twice, which reads as a bug and teaches
 * the reader that one of the two buttons is decorative.
 */
function secondaryUnless(primary: Cta, candidate: Cta): Cta | null {
  return primary.kind === candidate.kind ? null : candidate;
}

export function resolvePostAction(i: PostActionInput): PostActionExperience {
  switch (i.action) {
    case "create_market": {
      const { primary: chosen, module } = nextForBuy(i);
      const viewMarket: Cta = { kind: "view_market", label: "View Market" };
      // A creation has nowhere else to send anybody: "Next Question" is a buy's
      // exit, not a creator's.
      const primary = chosen.kind === "next_question" ? viewMarket : chosen;
      return {
        headline: "Your market is live.",
        support: i.side ? `You're backing ${i.side}.` : null,
        consequence: null,
        challengeModule: module,
        primary,
        secondary: secondaryUnless(primary, viewMarket),
        stayOnMarket: true,
        copyCategory: "market_maker",
      };
    }

    case "first_buy":
    case "buy_more":
    case "buy_opposite_side": {
      const { primary, module } = nextForBuy(i);
      const secondary = secondaryUnless(primary, {
        kind: "next_question",
        label: "Next Question",
      });

      /**
       * SOMEBODY ASKED, AND YOU ANSWERED — the strongest thing this screen can
       * say, and it outranks every personal fact including being first.
       *
       * SIDE-BLIND HEADLINE, ALWAYS. "You showed up for Maya" is identical
       * whether the reader agreed with Maya or not; the side is a separate
       * sentence. A Rival who turns up turned up.
       */
      if (i.answered) {
        const who = i.answered.primaryCallerName.trim();
        const headline =
          i.answered.count === 1
            ? // The type requires a name; an empty one is still refused rather
              // than rendered as "1 people".
              `You showed up for ${who || "someone"}.`
            : `You showed up for ${i.answered.count} people.`;
        return {
          headline,
          support: `You backed ${i.side}.`,
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
       * original side gone — may be called a flip, and that is exit territory.
       */
      if (i.action === "buy_opposite_side" && i.after.yes > 0 && i.after.no > 0) {
        return {
          headline: `You added ${i.side}.`,
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
          headline: `You added to ${i.side}.`,
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
          support: `You're backing ${i.side}.`,
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
        support: `You backed ${i.side}.`,
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
       * elsewhere treats the sale as a completed errand rather than a decision
       * they may still be making. `SellInput` carries no `nextIncoming` at all,
       * so the buy hierarchy is not merely unused here — it is unreachable.
       */
      const backToMarket: Cta = { kind: "back_to_market", label: "Back to Market" };

      /**
       * THE BALANCE READ FAILED. Say what is certainly true — the sale
       * confirmed — and refuse to characterise it. "You're out" to somebody who
       * still holds half their position is worse than saying nothing.
       */
      if (i.after == null) {
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

      const offer = canOffer(i) && spotsOpen(i.capacity) > 0;
      const full = canOffer(i) && spotsOpen(i.capacity) === 0;
      const sellPrimary: Cta = offer
        ? { kind: "challenge", label: challengeLabel(i.audience) }
        : full
          ? { kind: "make_room", label: "Make room" }
          : backToMarket;
      const sellModule: ChallengeModule = offer ? "organic" : full ? "make_room" : null;
      const sellSecondary = secondaryUnless(sellPrimary, backToMarket);
      const challengeLive: Consequence = i.outgoing === "live" ? "challenge_live" : null;

      if (i.action === "market_exit") {
        /**
         * A MARKET MAKER MAY STILL ASK. They are inviting people to answer their
         * QUESTION, not to copy a position — so the offer survives an exit that
         * would silence an ordinary believer, for whom it would read as asking
         * people into something they just left.
         */
        const makerMayAsk = i.role !== "believer";
        return {
          headline: makerMayAsk ? "Your position is closed." : "You're out.",
          support: makerMayAsk ? "Your question is still alive." : sellSupport(i),
          consequence: challengeLive,
          challengeModule: makerMayAsk ? sellModule : null,
          primary: makerMayAsk ? sellPrimary : backToMarket,
          secondary: makerMayAsk ? sellSecondary : null,
          stayOnMarket: true,
          copyCategory: makerMayAsk ? "market_maker" : "exit",
        };
      }

      const remaining: Side = i.after.yes > 0 ? "YES" : "NO";

      if (i.action === "side_exit") {
        return {
          headline: `You left ${i.side}.`,
          support: stillBacking(remaining, i.remainingValueUsd),
          consequence: challengeLive,
          challengeModule: sellModule,
          primary: sellPrimary,
          secondary: sellSecondary,
          stayOnMarket: true,
          copyCategory: "general",
        };
      }

      return {
        headline: "You took some off.",
        support: stillBacking(remaining, i.remainingValueUsd),
        consequence: challengeLive,
        challengeModule: sellModule,
        primary: sellPrimary,
        secondary: sellSecondary,
        stayOnMarket: true,
        copyCategory: "general",
      };
    }

    default:
      return assertNever(i);
  }
}

/**
 * Words this screen must never use, whatever the branch.
 *
 * Three families, each a lie of a different kind. The workflow words describe a
 * record changing rather than two people doing something. The delivery words
 * claim a channel this product does not have — no push, no email, no inbox, so
 * "notified" is simply false. The casino words import a reward system this
 * product decided against.
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
