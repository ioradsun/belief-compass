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

export function pulseFactsFromMarket({
  book,
  change,
  state,
  ethUsd,
}: {
  book: MarketBook;
  change?: MarketChange | null;
  state?: MarketStateFacts | null;
  /** ETH→USD rate; non-positive means unknown and USD facts are dropped. */
  ethUsd: number;
}): PulseFacts {
  const rate = ethUsd > 0 ? ethUsd : null;
  const believers = pair(change?.market.believers, book.believers.market, 1);
  const capital = pair(change?.market.capital, book.capitalEth.market, rate);

  return {
    believerDelta: believers.current - believers.base,
    believerBase: believers.base,
    believers: believers.current,
    capitalDeltaEth: capital.current - capital.base,
    capitalBaseEth: capital.base,
    events: book.believers.market.events + book.capitalEth.market.events,

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
