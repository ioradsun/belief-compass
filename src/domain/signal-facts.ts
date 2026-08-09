/**
 * signal-facts — the ONE mapping from a feed row + its market read model into
 * `SignalFacts`.
 *
 * Pure and viewer-blind. It exists so the diagnostic script and `buildTape`
 * cannot drift into two different definitions of "what the vector was shown".
 *
 * Nothing here ranks, scores or writes copy.
 */
import type { SignalActor, SignalFacts, Holder } from "./signal-vector";
import type { PriceProof } from "./price-proof";

/**
 * Rows that carry no market signal at all (plan §4). They still matter — a new
 * Rival can be the most important thing in Now — they simply say nothing about
 * market anomaly, so they get an all-zero vector rather than a small one.
 */
export const SOCIAL_SIGNAL_KINDS = new Set([
  "discovery_moment",
  "showed_up",
  "standing_fact",
  "relationship_story",
  "believer_milestone",
  "tribe_doubled",
  "conviction_cohort",
  "market_created",
  "welcome",
]);

export const isSocialSignalKind = (kind: string): boolean => SOCIAL_SIGNAL_KINDS.has(kind);

/** The subset of `market_state` the vector is allowed to see. */
export type MarketSignalSource = {
  yesPrice?: number | null;
  yesPriceChange1h?: number | null;
  yesPriceChange24h?: number | null;
  yesPriceChange7d?: number | null;
  yesCapitalDelta24h?: number | null;
  noCapitalDelta24h?: number | null;
  capitalHeldYes?: number | null;
  capitalHeldNo?: number | null;
  tradeCount24h?: number | null;
  tradeCount7d?: number | null;
  believersYes?: number | null;
  believersNo?: number | null;
  newBelievers24h?: number | null;
  newBelieversYes24h?: number | null;
  newBelieversNo24h?: number | null;
  peopleYesChange24h?: number | null;
  sideFlips24h?: number | null;
  lastTradeAt?: string | null;
};

export type RowSignalInput = {
  kind: string;
  /** The row's own trade, when it is about one. Bursts have no single actor. */
  wallet?: string | null;
  action?: "BUY" | "SELL" | null;
  amountUsd?: number | null;
  occurredAt?: string | null;
  /** Reconstructed hierarchy immediately before this row's trade, if proven. */
  preEventHolders?: Holder[] | null;
};

const n = (v: number | null | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/**
 * Build the facts for one feed row.
 *
 * `preEventHolders` is passed in rather than inferred: a large dollar amount is
 * never allowed to imply "a whale exited" (plan §2). When the hierarchy has not
 * been reconstructed, concentration simply stays zero.
 */
export function factsForRow(
  row: RowSignalInput,
  market: MarketSignalSource | null,
  nowMs: number,
  /**
   * Proven price behaviour since this row's moment (plan §8). Omitted or null
   * means ordering was never established — the vector then refuses any
   * before/after story rather than inferring one from a 24h window.
   */
  priceProof?: PriceProof | null,
): SignalFacts {
  if (isSocialSignalKind(row.kind) || !market) {
    return { isSocial: true, nowMs };
  }

  const actor: SignalActor | null =
    row.wallet && row.action && n(row.amountUsd) !== null
      ? {
          wallet: row.wallet.toLowerCase(),
          direction: row.action === "SELL" ? "sell" : "buy",
          amountUsd: Math.abs(n(row.amountUsd)!),
        }
      : null;

  const atMs = row.occurredAt ? Date.parse(row.occurredAt) : NaN;
  const input =
    actor && actor.direction === "buy" && Number.isFinite(atMs)
      ? { amountUsd: actor.amountUsd, atMs }
      : null;

  const newcomers =
    (n(market.newBelieversYes24h) ?? 0) + (n(market.newBelieversNo24h) ?? 0) || null;

  return {
    isSocial: false,
    yesPrice: n(market.yesPrice),
    yesPriceChange1h: n(market.yesPriceChange1h),
    yesPriceChange24h: n(market.yesPriceChange24h),
    yesPriceChange7d: n(market.yesPriceChange7d),
    yesCapitalDelta24h: n(market.yesCapitalDelta24h),
    noCapitalDelta24h: n(market.noCapitalDelta24h),
    capitalHeldYes: n(market.capitalHeldYes),
    capitalHeldNo: n(market.capitalHeldNo),
    tradeCount24h: n(market.tradeCount24h),
    tradeCount7d: n(market.tradeCount7d),
    believersYes: n(market.believersYes),
    believersNo: n(market.believersNo),
    newBelievers24h: n(market.newBelievers24h),
    peopleYesChange24h: n(market.peopleYesChange24h),
    sideFlips24h: n(market.sideFlips24h),
    newcomers24h: newcomers,
    actor,
    preEventHolders: row.preEventHolders ?? null,
    input,
    priceProof: priceProof ?? null,
    nowMs,
  };
}
