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
 * IT IS NOW THE OWNER. Every confirmed buy, sell and create builds a
 * `PostActionInput` and renders what this returns — see `PostActionScreen`. The
 * four components above still exist and still render beautifully; what they no
 * longer do is DECIDE. `ConvictionReveal` draws the personal story it is handed,
 * `KeepChainMoving` draws a Challenge module it is told to draw, and the route
 * executes the CTA it is given. Deleting the `resolvePostAction` call breaks all
 * three flows, which is the only real proof that a resolver is the owner rather
 * than architecture nobody reaches.
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
  /**
   * EVERY QUALIFYING PERSON IS IN THE STILL FORMING GROUP.
   *
   * A real audience, and a different sentence. "See who stands with you" assumes
   * a Tribe; somebody whose whole reachable network is people the engine cannot
   * yet name deserves the honest version rather than borrowed warmth. False when
   * the audience is empty — there is no group to be "only".
   */
  formingOnly: boolean;
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
  /**
   * HOW THE LIVE ONE IS DOING — read from the table, never inferred.
   *
   * "3 of 11 have shown up" is a claim about eleven real people. Null whenever
   * `outgoing` is not `live`, and null also when the table read failed, in which
   * case the consequence block says a Challenge is live and declines to quantify
   * it. A fraction is the one part of that sentence worth withholding.
   */
  outgoingProgress: { shown: number; reached: number } | null;
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
  /**
   * NULL UNTIL THE POST-TRADE BALANCE LANDS — the same rule a sell already had,
   * and the same reason.
   *
   * This used to be a required `Holdings`, so the adapter defaulted it to
   * `{ yes: 0, no: 0 }` to satisfy the type. That fabricated a holdings reading
   * out of an unsettled read, and the type could not tell the difference. The
   * visible cost was a Market Maker who had just bought their own YES being
   * classified `market_maker` rather than `market_maker_and_believer` for as
   * long as the refetch took — even though the confirmed transaction already
   * proved the position.
   *
   * THE RULE, NOW CONSISTENT ACROSS ALL THREE ACTIONS: a confirmed action proves
   * the ACTION. A balance proves the resulting HOLDINGS. Nothing fabricates the
   * second to satisfy a type.
   */
  after: Holdings | null;
  /**
   * THE VERY FIRST BELIEVER ON THIS SIDE — the same fact `conviction-reveal`
   * already computes, passed in rather than recomputed. It earns its own
   * headline because "You're first" is a stronger and more checkable statement
   * than "That's a real call", and the reveal underneath can then spend its
   * strongest card on something else.
   */
  firstBeliever: boolean;
  /**
   * A PROVEN DIRECTIONAL FLIP: the original side is GONE, not merely joined.
   *
   * Holding both sides is not a change of mind, and the difference is the whole
   * reason this is a separate field rather than derived from `side`. Only the
   * canonical post-trade balance can establish it, so it arrives as a fact.
   */
  flipped: boolean;
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
  | "see_chain"
  | "answer";

export interface Cta {
  kind: CtaKind;
  label: string;
}

/** At most one consequence block. Never two. */
export type Consequence = "reveal" | "branch_live" | "challenge_live" | null;

/** At most one social module, and `make_room` is one of its shapes. */
export type ChallengeModuleKind = "relay" | "organic" | "still_forming" | "sell" | "make_room";

/**
 * THE MODULE'S OWN HEADING, WRITTEN HERE RATHER THAN IN THE COMPONENT.
 *
 * A screen that picked its own heading from the module kind would be a second
 * copy owner, and the two would drift the first time one of them learned a new
 * case. The resolver decides meaning AND the words for it; the screen renders.
 */
export interface ChallengeModule {
  kind: ChallengeModuleKind;
  title: string;
  support: string;
}

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
  /**
   * THE ONE LINE THE CONSEQUENCE BLOCK PRINTS, or null when it has no number to
   * print. "Your branch is already live" with no fraction is still true; "3 of
   * 11 have shown up" with a guessed denominator is not.
   */
  consequenceLine: string | null;
  challengeModule: ChallengeModule | null;
  /**
   * WHO THIS PERSON IS IN THIS MARKET, when it is worth saying.
   *
   * "MARKET MAKER · BACKING YES" — never reduced to "BELIEVER · YES". Somebody
   * who wrote the question and then backed it is both, and the authorship is the
   * larger fact. Null for an ordinary believer, who needs no badge.
   */
  identity: string | null;
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
const MAKE_ROOM_MODULE: ChallengeModule = {
  kind: "make_room",
  title: "Your table is full",
  support: "Three questions already have a place.",
};

/**
 * THE MODULE'S HEADING, CHOSEN BY WHAT IS ACTUALLY TRUE OF THIS AUDIENCE.
 *
 * `still_forming` outranks the others when it applies, because the sentence it
 * replaces would be a small lie: "see who stands with you" said to somebody
 * whose entire reachable network is unnamed relationships promises a Tribe they
 * do not have. The honest version is not a downgrade — an answer from a Still
 * Forming person is the single most informative thing the graph can receive.
 */
function moduleFor(kind: ChallengeModuleKind, audience: Audience): ChallengeModule {
  if (audience.formingOnly)
    return {
      kind: "still_forming",
      title: "The map is still taking shape",
      support: "Every honest answer makes it clearer.",
    };
  switch (kind) {
    case "relay":
      return {
        kind,
        title: "Keep the chain moving",
        support: "Somebody asked you. The same is available to you, once.",
      };
    case "sell":
      return {
        kind,
        title: "Still in this one",
        support: "See where your people land.",
      };
    default:
      return {
        kind: "organic",
        title: "Belief is easy when no one can answer back",
        support: "Put this one in front of your people.",
      };
  }
}

function nextForBuy(i: CreateMarketInput | BuyInput): {
  primary: Cta;
  module: ChallengeModule | null;
} {
  if (canOffer(i) && spotsOpen(i.capacity) > 0) {
    const kind: ChallengeModuleKind =
      i.action !== "create_market" && i.answered ? "relay" : "organic";
    return {
      primary: { kind: "challenge", label: challengeLabel(i.audience) },
      module: moduleFor(kind, i.audience),
    };
  }
  if (canOffer(i) && spotsOpen(i.capacity) === 0) {
    return { primary: { kind: "make_room", label: "Make room" }, module: MAKE_ROOM_MODULE };
  }
  const waiting = i.action !== "create_market" ? i.nextIncoming?.name.trim() : null;
  if (waiting) return { primary: { kind: "answer", label: `Answer ${waiting}` }, module: null };
  return { primary: { kind: "next_question", label: "Next Question" }, module: null };
}

/**
 * "3 of 11 have shown up." — and SILENCE rather than a guess.
 *
 * A denominator is a claim about that many real people. When the table read did
 * not complete, the consequence block still says a Challenge is live (which is
 * known from the ledger) and prints no fraction, because half of this sentence
 * is checkable and the other half would be invented.
 */
function progressLine(p: { shown: number; reached: number } | null): string | null {
  if (!p || p.reached <= 0) return null;
  return `${p.shown} of ${p.reached} have shown up.`;
}

/**
 * MARKET MAKER FIRST, ALWAYS. Somebody who wrote the question and then backed it
 * is both, and authorship is the larger fact — being reduced to "BELIEVER · YES"
 * on your own market is the identity error this line exists to prevent.
 */
function identityFor(role: MarketRole, side: Side | null): string | null {
  if (role === "believer") return null;
  return side ? `Market Maker · Backing ${side}` : "Market Maker";
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
      /**
       * A SUCCESSFUL CREATION IS NEVER TURNED INTO AN EMPTY-NETWORK MESSAGE.
       *
       * With an audience the support line is an invitation — the question began
       * with you, it does not have to end there. With NO audience it is still a
       * completed act, so the sentence celebrates the act itself. What it must
       * never do is answer "you made something" with "nobody qualifies", which
       * is the reader's first market meeting their thinnest moment.
       */
      const support = module
        ? "The question began with you. It doesn't have to end there."
        : "You gave the question a place to live.";
      return {
        headline: "Your market is live.",
        support,
        consequence: null,
        consequenceLine: null,
        challengeModule: module,
        identity: identityFor(i.role, i.side),
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
       * A LIVE BRANCH IS A LIVE BRANCH IN EVERY BUY, and this used to be decided
       * per-branch — so it appeared for an answered call and for buying more,
       * and vanished for a first buy or a creator backing their own question.
       * Those are exactly the cases where it is most surprising to lose: a
       * Market Maker who put their question up and only now takes a side has a
       * Challenge running that this screen would not have mentioned.
       *
       * `reveal` yields to it. Both are consequence blocks and there is only one
       * slot; "3 of 11 have shown up" is news about other people, and the
       * personal reveal is available on every subsequent buy.
       */
      const branchLive: Consequence = i.outgoing === "live" ? "branch_live" : null;
      const branchLine = branchLive ? progressLine(i.outgoingProgress) : null;

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
          consequence: branchLive,
          consequenceLine: branchLine,
          challengeModule: module,
          identity: identityFor(i.role, i.side),
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
      if (i.action === "buy_opposite_side" && i.after && i.after.yes > 0 && i.after.no > 0) {
        return {
          headline: `You added ${i.side}.`,
          support: "You now hold both sides.",
          consequence: branchLive,
          consequenceLine: branchLine,
          challengeModule: module,
          identity: identityFor(i.role, null),
          primary,
          secondary,
          stayOnMarket: false,
          // Neutral on purpose: "see who stands with you" is the wrong sentence
          // for somebody holding both sides.
          copyCategory: "general",
        };
      }

      /**
       * A FLIP IS A CANONICAL FACT, NOT AN INFERENCE FROM THE BUTTON PRESSED.
       *
       * `flipped` means the post-trade balance shows the original side GONE.
       * Holding both is handled above and is not a change of mind; buying the
       * other side while keeping the first is somebody widening a position, and
       * calling that a flip would put words in their mouth about a belief they
       * still hold.
       */
      if (i.flipped) {
        return {
          headline: `Your position flipped to ${i.side}.`,
          support: null,
          consequence: branchLive,
          consequenceLine: branchLine,
          challengeModule: module,
          identity: identityFor(i.role, i.side),
          primary,
          secondary,
          stayOnMarket: false,
          copyCategory: "general",
        };
      }

      /**
       * THE OTHER SIDE WAS BOUGHT AND THE BALANCE HAS NOT LANDED.
       *
       * Reached only when neither "you now hold both sides" nor a proven flip
       * can be established — both need a reading. The purchase is certain and
       * says so; what it produced is not, and stays unsaid rather than being
       * guessed in either direction.
       */
      if (i.action === "buy_opposite_side") {
        return {
          headline: `You added ${i.side}.`,
          support: null,
          consequence: branchLive,
          consequenceLine: branchLine,
          challengeModule: module,
          identity: identityFor(i.role, null),
          primary,
          secondary,
          stayOnMarket: false,
          copyCategory: "general",
        };
      }

      if (i.action === "buy_more") {
        return {
          headline: `You added to ${i.side}.`,
          support: "Your conviction grew.",
          consequence: branchLive,
          consequenceLine: branchLine,
          challengeModule: module,
          identity: identityFor(i.role, i.side),
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
          consequence: branchLive,
          consequenceLine: branchLine,
          challengeModule: module,
          identity: identityFor(i.role, i.side),
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
      /**
       * FIRST, AND SAYING SO PLAINLY. It is the rarest checkable fact a buy can
       * carry, and it outranks the generic confirmation — the reveal underneath
       * then spends its strongest card on something the headline did not use.
       */
      if (i.firstBeliever) {
        return {
          headline: "You're first.",
          support: `You're the first believer on ${i.side}.`,
          consequence: branchLive ?? "reveal",
          consequenceLine: branchLine,
          challengeModule: module,
          identity: null,
          primary,
          secondary,
          stayOnMarket: false,
          copyCategory: "first_or_early",
        };
      }

      return {
        headline: "That's a real call.",
        support: `You backed ${i.side}.`,
        consequence: branchLive ?? "reveal",
        consequenceLine: branchLine,
        challengeModule: module,
        identity: null,
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
          consequenceLine: null,
          challengeModule: null,
          identity: null,
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
      const sellModule: ChallengeModule | null = offer
        ? moduleFor("sell", i.audience)
        : full
          ? MAKE_ROOM_MODULE
          : null;
      const challengeLive: Consequence = i.outgoing === "live" ? "challenge_live" : null;
      /**
       * WHEN A CHALLENGE IS ALREADY LIVE HERE, THE SECOND ACTION IS THE CHAIN.
       *
       * "Back to Market" and "See chain" go to different places and answer
       * different questions — the market is the position, the chain is the
       * people. A live Challenge is the only state where the second one exists
       * to look at, so it is the only state that offers it.
       */
      const seeChain: Cta = { kind: "see_chain", label: "See chain" };
      const sellSecondary = challengeLive
        ? secondaryUnless(sellPrimary, seeChain)
        : secondaryUnless(sellPrimary, backToMarket);

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
          consequenceLine: challengeLive ? progressLine(i.outgoingProgress) : null,
          challengeModule: makerMayAsk ? sellModule : null,
          // A creator who has exited still authored the question. No side —
          // they hold none — but the authorship does not lapse with the position.
          identity: makerMayAsk ? identityFor(i.role, null) : null,
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
          consequenceLine: challengeLive ? progressLine(i.outgoingProgress) : null,
          challengeModule: sellModule,
          identity: identityFor(i.role, remaining),
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
        consequenceLine: challengeLive ? progressLine(i.outgoingProgress) : null,
        challengeModule: sellModule,
        identity: identityFor(i.role, remaining),
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

/* ── The Challenge write, and what to say when it refuses ─────────────────── */

/** Every way the server can refuse to put a question on the table. */
export type WriteRefusal =
  | "full"
  | "already_up"
  | "no_audience"
  | "audience_unavailable"
  | "bad_parent"
  | "no_reach"
  | "failed";

/**
 * A TRANSIENT FACT ABOUT ONE PRESS — deliberately NOT part of the experience.
 *
 * `resolvePostAction` answers "what is true of this market and this person", and
 * a failed write changes neither: `put_on_table` rolls back whole, so nothing
 * was created, no slot was spent, and nothing was carried. Folding a refusal
 * into the resolver would make a momentary network error look like a permanent
 * property of somebody's position.
 *
 * So it rides alongside. The screen renders the same experience with one extra
 * block on top, and the block disappears on retry.
 */
export type ActionStatus =
  | { state: "idle" }
  | { state: "pending" }
  | { state: "failed"; message: string };

/**
 * SOME REFUSALS ARE NOT FAILURES — they are the canonical state, arriving late.
 *
 * `already_up` and `full` mean another tab won a race, and re-reading the table
 * makes the screen say the true thing on its own: "your branch is already live",
 * or a Make room offer. `no_audience` and `no_reach` mean the audience moved
 * under the press, and a re-read produces the honest "nobody new to ask".
 *
 * Reporting any of those as "couldn't put it on the table" would be technically
 * accurate and actively misleading — the reader would retry against a state that
 * is going to refuse them again, for a reason the screen could simply have said.
 */
export function refusalIsCanonical(reason: WriteRefusal): boolean {
  return (
    reason === "already_up" ||
    reason === "full" ||
    reason === "no_audience" ||
    reason === "no_reach"
  );
}

/**
 * WHAT A GENUINE FAILURE SAYS. Short, and with no database in it.
 *
 * "Nothing changed" is the important half and it is literally true — the write
 * is one transaction, so a refusal leaves no Challenge, no spent slot and no
 * repointed call. It is also the only thing the reader actually needs: they
 * pressed a button at the emotional peak of the product and are owed the
 * knowledge that their table is exactly as they left it.
 */
export const WRITE_FAILED_TITLE = "Couldn't put it on the table";
export const WRITE_FAILED_SUPPORT = "Nothing changed.";
export const WRITE_RETRY_LABEL = "Try again";

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
