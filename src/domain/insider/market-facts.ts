/**
 * THE MARKET FACTS ADAPTER — canonical market numbers → `PulseFacts`.
 *
 * The Insider interprets facts; it does not go and get them. This is the one
 * place that translates what a market surface already holds — the canonical
 * `marketBook` replay, the shared `MarketChange` answer, and the `market_state`
 * row — into the structural input `insiderPulse` reads.
 *
 * It exists so that no component ever assembles those inputs itself (which is
 * how four surfaces ended up with four momentum readings), and so the mapping is
 * testable without a component or a database.
 *
 * PRECEDENCE, AND WHY. The authoritative shared answer (`MarketChange`) wins
 * wherever it exists; the tape replay in `marketBook` is only the cold-start
 * fallback while that answer is in flight. That is the same precedence
 * MarketVitality already applied to its printed numbers, so the pulse can never
 * describe a different window than the figures beside it.
 *
 * Pure, ZERO IO, deterministic.
 */
import type { MarketBook } from "../market-book";
import type { MarketChange, MetricChange } from "../market-change";
import type { PulseFacts } from "./pulse";

/** The `market_state` fields the pulse can use. Every one is optional. */
export interface MarketStateFacts {
  believersYes?: number | null;
  believersNo?: number | null;
  /** Capital currently held on each side, in USD (as market_state stores it). */
  capitalHeldYesUsd?: number | null;
  capitalHeldNoUsd?: number | null;
  tradeCount24h?: number | null;
  tradeCount7d?: number | null;
  yesPriceUsd?: number | null;
  yesPriceChange1h?: number | null;
  yesPriceChange24h?: number | null;
  /** The market's most recent interesting moment, ISO. */
  lastTradeAt?: string | null;
}

const num = (n: number | null | undefined): number | null =>
  typeof n === "number" && Number.isFinite(n) ? n : null;

/** USD → ETH, or null when there is no usable rate (never a fabricated zero). */
const toEth = (usd: number | null, ethUsd: number): number | null =>
  usd == null || !(ethUsd > 0) ? null : usd / ethUsd;

/**
 * The shared answer where we have it, the book replay otherwise — expressed in
 * the metric's own unit. `divisor` converts a USD-denominated change back (1 for
 * believers; the ETH rate for capital).
 */
function pair(
  m: MetricChange | undefined,
  fallback: { current: number; base: number },
  divisor: number | null,
): { current: number; base: number } {
  if (m == null || m.current == null || divisor == null || divisor === 0) return fallback;
  const current = m.current / divisor;
  return { current, base: m.base == null ? current : m.base / divisor };
}

/** A market with no tape replay in hand — the state row still speaks. */
const EMPTY_METRIC = { current: 0, base: 0, events: 0 };

export function pulseFactsFromMarket({
  book,
  change,
  state,
  ethUsd,
}: {
  /** The canonical tape replay. Optional: a surface holding only the state row
   *  (the personal read, a card) still gets direction and standing facts. */
  book?: MarketBook | null;
  change?: MarketChange | null;
  state?: MarketStateFacts | null;
  /** ETH→USD rate; non-positive means unknown and USD facts are dropped. */
  ethUsd: number;
}): PulseFacts {
  const rate = ethUsd > 0 ? ethUsd : null;
  const believerBook = book?.believers.market ?? EMPTY_METRIC;
  const capitalBook = book?.capitalEth.market ?? EMPTY_METRIC;
  const believers = pair(change?.market.believers, believerBook, 1);
  const capital = pair(change?.market.capital, capitalBook, rate);

  return {
    believerDelta: believers.current - believers.base,
    believerBase: believers.base,
    believers: believers.current,
    capitalDeltaEth: capital.current - capital.base,
    capitalBaseEth: capital.base,
    events: believerBook.events + capitalBook.events,

    believersYes: num(state?.believersYes),
    believersNo: num(state?.believersNo),
    capitalHeldYesEth: toEth(num(state?.capitalHeldYesUsd), ethUsd),
    capitalHeldNoEth: toEth(num(state?.capitalHeldNoUsd), ethUsd),

    tradeCount24h: num(state?.tradeCount24h),
    tradeCount7d: num(state?.tradeCount7d),

    yesPrice: num(state?.yesPriceUsd),
    yesPriceChange1h: num(state?.yesPriceChange1h),
    yesPriceChange24h: num(state?.yesPriceChange24h),

    lastInterestingEventAt: state?.lastTradeAt ?? null,
  };
}

/**
 * A `market_state` row (as the deck already holds it) → the facts above. Kept
 * beside the pulse adapter so the column names appear exactly once, rather than
 * in every component that happens to have a row in hand.
 */
export function marketStateFacts(row: Record<string, unknown> | null | undefined): MarketStateFacts {
  const n = (k: string): number | null => {
    const v = row?.[k];
    return typeof v === "number" && Number.isFinite(v) ? v : v == null ? null : num(Number(v));
  };
  const s = (k: string): string | null => {
    const v = row?.[k];
    return typeof v === "string" ? v : null;
  };
  return {
    believersYes: n("believers_yes"),
    believersNo: n("believers_no"),
    capitalHeldYesUsd: n("yes_capital_usd"),
    capitalHeldNoUsd: n("no_capital_usd"),
    tradeCount24h: n("trade_count_24h"),
    tradeCount7d: n("trade_count_7d"),
    yesPriceUsd: n("yes_price_usd"),
    yesPriceChange1h: n("yes_price_change_1h"),
    yesPriceChange24h: n("yes_price_change_24h"),
    lastTradeAt: s("last_trade_at"),
  };
}
