/**
 * THE FACTS THE CLOSING SCREEN IS DECIDED FROM — gathered, never interpreted.
 *
 * THE DIVISION THIS FILE EXISTS TO HOLD:
 *
 *   ADAPTER   gathers. What action confirmed, who this person is in this market,
 *             what they hold now, who they answered, what is already on their
 *             table, who could still be reached. Every value is read from a
 *             canonical source or left null.
 *   RESOLVER  decides meaning. Which sentence, which module, which CTA.
 *   SCREEN    renders the result and nothing else.
 *
 * IT IS THE DIVISION THAT MAKES THE OWNERSHIP TRANSFER PROVABLE. While four
 * components each gathered their own facts AND drew their own conclusions, there
 * was no way to tell a copy change from a logic change, and no single place a
 * new state could be handled. If this file ever starts choosing a headline, the
 * old problem is back under a new name.
 *
 * NULL IS A REAL ANSWER HERE. A balance that has not refetched, a table read
 * that failed, an audience still loading — each stays null or `loading` rather
 * than being defaulted to zero, because `resolvePostAction` has a different and
 * more careful branch for "unknown" than it does for "none", and the whole point
 * of the split is that this file does not get to collapse them.
 */
import { useQuery } from "@tanstack/react-query";
import { useTable } from "@/components/YourTable";
import { useAudience } from "@/components/AudiencePreview";
import { answeredCallKey, closedCallsKey } from "@/hooks/useAnswerCalls";
import { tableProgress, TABLE_SLOTS } from "@/domain/table";
import { audienceGroupFor } from "@/domain/audience";
import { formatCC, type RecordMode } from "@/domain/simulation";
import { useSimulationMode } from "@/lib/simulation-mode";
import type { NamedPerson } from "@/domain/challenge";
import type {
  Audience,
  BuyInput,
  CreateMarketInput,
  Holdings,
  MarketRole,
  NoHoldings,
  PostActionInput,
  SellInput,
  Side,
} from "@/domain/post-action";

/** Everything the caller must already know about the action it just confirmed. */
export interface ConfirmedAction {
  marketId: number;
  /** Null only for a creation that seeded no position. */
  side: Side | null;
  /** Whether this wallet authored the market. Decides Market Maker identity. */
  authored: boolean;
  /**
   * WHAT THEY HOLD AFTER THE ACTION, or null when the balance read has not
   * settled. Never zeroed to make a branch reachable — `{ yes: 0, no: 0 }` is
   * the claim "they are out", and guessing it is how a partial seller gets told
   * they left.
   */
  after: Holdings | null;
  /** The side they held BEFORE, so a flip can be proved rather than assumed. */
  before?: Holdings | null;
  proceedsUsd?: number | null;
  realizedGainUsd?: number | null;
  remainingValueUsd?: number | null;
  /** The same fact `conviction-reveal` computes. Passed in, never recomputed. */
  firstBeliever?: boolean;
  /** Somebody else still waiting on this reader, for the fallback exit. */
  nextIncoming?: { name: string } | null;
}

/**
 * MARKET MAKER FIRST. Authorship is a permanent fact about a market and a
 * position is not, so somebody who wrote the question and then backed it is
 * `market_maker_and_believer` — never demoted to `believer` because they happen
 * to hold something.
 *
 * USED FOR SELLS ONLY. A sell is the one action whose ROLE genuinely depends on
 * the resulting balance: a creator who just exited holds nothing and is a
 * `market_maker` again. A buy and a create prove the believer relationship by
 * happening — see `buyRole` below.
 */
function roleFor(authored: boolean, holds: boolean): MarketRole {
  if (!authored) return "believer";
  return holds ? "market_maker_and_believer" : "market_maker";
}

/**
 * A CONFIRMED BUY PROVES THE POSITION. No balance required.
 *
 * The old code derived this from `act.after`, which is null until the on-chain
 * read refetches — so a Market Maker who had just bought their own YES was
 * classified `market_maker` rather than `market_maker_and_believer` for the
 * width of that gap, and the identity line said less than the transaction
 * already proved. The transaction is the evidence; the balance only says how
 * much.
 */
function buyRole(authored: boolean): MarketRole {
  return authored ? "market_maker_and_believer" : "believer";
}

/**
 * A FLIP IS PROVED FROM TWO BALANCES, or it is not claimed.
 *
 * The old side must have been held and must now be gone. Without a `before`
 * reading there is no evidence of a transition — only a current position, which
 * is equally consistent with somebody who always held that side.
 */
function provenFlip(before: Holdings | null | undefined, after: Holdings | null): boolean {
  if (!before || !after) return false;
  return (
    (before.yes > 0 && after.yes === 0 && after.no > 0) ||
    (before.no > 0 && after.no === 0 && after.yes > 0)
  );
}

/** Which sell this was, decided only from balances that actually exist. */
function sellAction(
  side: Side,
  after: Holdings | null,
): "partial_sell" | "side_exit" | "market_exit" | "unknown" {
  if (!after) return "unknown";
  if (after.yes === 0 && after.no === 0) return "market_exit";
  const soldSideGone = side === "YES" ? after.yes === 0 : after.no === 0;
  return soldSideGone ? "side_exit" : "partial_sell";
}

/**
 * THE AUDIENCE, AS THE RESOLVER NEEDS TO SEE IT.
 *
 * `formingOnly` is computed here rather than in the domain because it is a fact
 * about the fetched groups, and the resolver must not learn the shape of a query
 * payload. `failed` survives as `failed`: this is the exact seam where a blocked
 * read has historically become "nobody qualifies", and the two words are one
 * character apart in a switch.
 */
export function useAudienceFacts(
  wallet?: string,
  marketId?: number,
  mode: RecordMode = "REAL",
): Audience {
  /**
   * GRADUATION OUTRANKS THE RELAY.
   *
   * Once the tenth conviction lands, no NEW outgoing Simulation Challenge may be
   * offered — the reader is leaving the mode, and asking people to meet them
   * somewhere they are about to exit is a promise the product cannot keep.
   * Reported as `none` rather than a disabled button, because a CTA that cannot
   * be used is a smaller version of a promise that cannot be kept, and the
   * resolver already knows what to do with an audience of nobody.
   *
   * An INCOMING answer is unaffected: a tenth conviction that answers somebody
   * is recorded normally, inside the order transaction.
   */
  const { active: simulating, canOrder } = useSimulationMode();
  const graduating = simulating && !canOrder;

  const { data, isLoading } = useAudience(wallet, marketId, mode);
  if (graduating) return NO_AUDIENCE;
  if (isLoading || !data) return LOADING_AUDIENCE;
  switch (data.status) {
    case "available":
      return {
        status: "available",
        total: data.total,
        singleRecipientName: data.singleRecipientName,
        formingOnly:
          data.members.length > 0 &&
          data.members.every((m) => audienceGroupFor(m.relationAtCall) === "forming"),
      };
    case "failed":
      return { status: "failed", total: 0, singleRecipientName: null, formingOnly: false };
    case "loading":
      return LOADING_AUDIENCE;
    case "none":
      return { status: "none", total: 0, singleRecipientName: null, formingOnly: false };
    default: {
      const never: never = data;
      throw new Error(`unhandled audience status: ${JSON.stringify(never)}`);
    }
  }
}

const LOADING_AUDIENCE: Audience = {
  status: "loading",
  total: 0,
  singleRecipientName: null,
  formingOnly: false,
};

/** Nobody to ask — the honest empty, distinct from a read that failed. */
const NO_AUDIENCE: Audience = {
  status: "none",
  total: 0,
  singleRecipientName: null,
  formingOnly: false,
};

/**
 * WHAT THIS PERSON ALREADY HAS UP — capacity, and the state of this market.
 *
 * `outgoingProgress` is null unless a LIVE Challenge for this market is present
 * in a table read that succeeded. A failed read leaves the fraction unsaid; the
 * resolver still reports that a Challenge is live if the ledger said so, and
 * declines to quantify it.
 */
function useTableFacts(wallet?: string, marketId?: number, mode: RecordMode = "REAL") {
  const { data: table } = useTable(wallet, mode);
  const live = (table ?? []).filter((r) => r.closedAtMs == null);
  const mine = live.find((r) => r.marketId === marketId);
  const progress = mine ? tableProgress(mine.recipients) : null;
  return {
    outgoing: (mine ? "live" : "none") as "live" | "none",
    outgoingProgress:
      progress && progress.reached > 0
        ? { shown: progress.showedUp, reached: progress.reached }
        : null,
    capacity: { active: live.length, total: TABLE_SLOTS },
  };
}

/**
 * WHO THIS ACTION ANSWERED — written by `useAnswerCalls` when the trade settled.
 *
 * A handoff between siblings rather than a fetch: there is nothing to go and ask
 * for, and a request here would race the write it is waiting on. `enabled:
 * false` with `initialData` is how that is expressed.
 */
function useAnsweredFacts(marketId?: number) {
  const { data: closed } = useQuery<NamedPerson[]>({
    queryKey: closedCallsKey(marketId ?? -1),
    enabled: false,
    initialData: [],
  });
  const { data: answeredMeta } = useQuery<{ parentCall: number | null }>({
    queryKey: answeredCallKey(marketId ?? -1),
    enabled: false,
    initialData: { parentCall: null },
  });
  const people = closed ?? [];
  /**
   * THE NAME IS REQUIRED BY THE TYPE, and every server path already falls back
   * to a wallet alias, so a null here means the payload itself is malformed. The
   * whole answered block is dropped rather than rendering "You showed up for
   * someone" — a caller this product cannot name is one it refuses to speak
   * about, and an unnamed reciprocity claim is worse than an organic buy.
   */
  const primary = people[0]?.name?.trim();
  return {
    answered:
      people.length > 0 && primary ? { count: people.length, primaryCallerName: primary } : null,
    parentCall: answeredMeta?.parentCall ?? null,
  };
}

export interface PostActionFacts {
  input: PostActionInput;
  /** The lineage pointer a relay from this screen must carry. */
  parentCall: number | null;
}

/**
 * THE ONE ADAPTER. Every confirmed buy, sell and create passes through here.
 *
 * `kind` is the caller's own knowledge of what it just did — a component that
 * has confirmed a sale knows it was a sale. Everything downstream of that is
 * read, so the SHAPE of the sell (partial, side exit, full exit) is decided by
 * balances rather than by which button was pressed.
 */
export function usePostActionFacts(
  kind: "buy" | "sell" | "create",
  wallet: string | undefined,
  act: ConfirmedAction,
  /**
   * WHICH LEDGER THIS ACTION LANDED IN. Every fact gathered below is read from a
   * mode-scoped source — the audience a Simulation Challenge could reach, the
   * Simulation table's capacity — so the resolver decides about one world rather
   * than a mixture of two.
   */
  mode: RecordMode = "REAL",
): PostActionFacts {
  const audience = useAudienceFacts(wallet, act.marketId, mode);
  const { outgoing, outgoingProgress, capacity } = useTableFacts(wallet, act.marketId, mode);
  const { answered, parentCall } = useAnsweredFacts(act.marketId);

  const holds = !!act.after && (act.after.yes > 0 || act.after.no > 0);
  /**
   * THE MARKET IS THE SEED, and that is the whole of the rotation policy here.
   *
   * Two different questions should not read as the same screen, and the same
   * question must read identically every time it is drawn — including across a
   * refetch, a remount, and a second device. A market id is stable, carries no
   * clock, and is already canonical. Nothing else is used, and in particular
   * nothing that changes between renders is: the reader must never be able to
   * watch the emotional premise mutate while looking at unchanged state.
   */
  const common = {
    outgoing,
    outgoingProgress,
    capacity,
    audience,
    copySeed: String(act.marketId),
    mode,
    /**
     * THE UNIT THE RESOLVER MAY PRINT. Supplied rather than assumed: the domain
     * module owns what may be SAID about a value, and this owns which ledger the
     * value belongs to. In Real Mode it is omitted, which leaves the resolver's
     * dollar default exactly where it was.
     */
    formatValue: mode === "SIMULATION" ? (v: number) => formatCC(v) : undefined,
  } as const;

  if (kind === "create") {
    const input: CreateMarketInput = {
      ...common,
      action: "create_market",
      /**
       * A creation is authored by definition; `believer` cannot occur. And a
       * creation that SEEDED a side proves the position the same way a buy
       * does — the balance is not consulted for it.
       */
      role: act.side ? "market_maker_and_believer" : "market_maker",
      side: act.side,
    };
    return { input, parentCall };
  }

  if (kind === "sell") {
    // The one action whose role really does depend on what is left.
    const role = roleFor(act.authored, holds);
    const side = act.side ?? "YES";
    const shape = sellAction(side, act.after);
    const money = {
      role,
      side,
      realizedGainUsd: act.realizedGainUsd ?? null,
      proceedsUsd: act.proceedsUsd ?? null,
      remainingValueUsd: act.remainingValueUsd ?? null,
    };
    /**
     * AN UNREADABLE BALANCE IS ITS OWN SHAPE, not a default to the mildest one.
     * `partial_sell` with `after: null` is the input the resolver answers with
     * "Sale confirmed. Your position is updating." — no characterisation at all.
     */
    const input: SellInput =
      shape === "market_exit"
        ? { ...common, ...money, action: "market_exit", after: act.after as NoHoldings }
        : shape === "side_exit"
          ? { ...common, ...money, action: "side_exit", after: act.after }
          : {
              ...common,
              ...money,
              action: "partial_sell",
              after: shape === "unknown" ? null : act.after,
            };
    return { input, parentCall };
  }

  /**
   * UNKNOWN IS NOT ZERO, and this line used to be `act.after ?? { yes: 0, no: 0 }`
   * — a fabricated holdings reading, invented purely so a required field could
   * be filled. `BuyInput.after` is nullable now and the fabrication is gone.
   */
  const after = act.after;
  const side = act.side ?? "YES";
  const held = side === "YES" ? (act.before?.yes ?? 0) : (act.before?.no ?? 0);
  const heldOther = side === "YES" ? (act.before?.no ?? 0) : (act.before?.yes ?? 0);
  const input: BuyInput = {
    ...common,
    role: buyRole(act.authored),
    action: held > 0 ? "buy_more" : heldOther > 0 ? "buy_opposite_side" : "first_buy",
    side,
    after,
    firstBeliever: act.firstBeliever ?? false,
    flipped: provenFlip(act.before, act.after),
    answered,
    nextIncoming: act.nextIncoming ?? null,
  };
  return { input, parentCall };
}
