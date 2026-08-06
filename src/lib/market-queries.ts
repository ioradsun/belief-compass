/**
 * ONE MARKET'S TWO EXPENSIVE READS — one definition each, and no timer on either.
 *
 * WHAT THIS FIXES. `["market-change", id]` was declared at five call sites and
 * `["evidence", id]` at four. They agreed on the key, so React Query deduped the
 * request — and disagreed on the options, which React Query does NOT dedupe:
 *
 *   market-change   MarketDeck 15s · CaseFile 15s · MobileGame 20s · index — · prefetch —
 *   evidence        MarketDeck 60s · CaseFile 60s · SharedConviction 60s · prefetch —
 *
 * A shared query takes the most aggressive `refetchInterval` any observer asks
 * for, so the phone's 20s was never the phone's: mounting the deck re-timed the
 * whole key to 15s. `market-change-query.ts` names this exact failure in its
 * header — it was fixed for baselines and left standing on the two keys that
 * cost the most.
 *
 * WHY NO INTERVAL AT ALL. Both of these are functions of one thing: whether that
 * market has traded. `getMarketChange` replays the trade tape (up to 1,000
 * `events` rows on the service client, plus a `market_state` read).
 * `getMarketEvidence` runs four service-client queries including a 200-row
 * `wallet_beliefs` read and a 60-day price-series RPC. Between trades, both
 * return byte-identical answers.
 *
 * And the app already receives the trade. The realtime coordinator subscribes to
 * `events` INSERT and knows precisely which market moved — it just wasn't
 * telling these two caches. It is now (see coordinator.ts `drainActivity`), so
 * the poll has nothing left to discover.
 *
 * THE NUMBERS THAT SETTLED IT (production, measured 2026-08-06):
 *   • 2,776 markets; 42 traded in the last 24h; 151 trades platform-wide.
 *   • The single busiest market: 74 trades in 24h — one every 19 minutes.
 *   • Median market in the traded set: 1 trade in 24h. The other 2,734 markets:
 *     none at all.
 *
 * A deck at 15s polls 240 times an hour. On the busiest market on the platform
 * that is ~78 tape replays per real trade; on a typical one it is thousands. The
 * timer was not keeping the deck fresh — the stream was, up to 15 seconds
 * earlier — while the timer paid for it.
 *
 * `staleTime` still matters, and stays: it is what makes a remount (opening the
 * Case File, rotating to the phone layout, stepping back to a market) reuse the
 * cache instead of refetching.
 */
import { queryOptions } from "@tanstack/react-query";
import { getMarketChange } from "@/lib/markets.functions";
import { getMarketEvidence } from "@/lib/evidence.functions";

/**
 * How long each answer is trusted without a new reason to doubt it.
 *
 * These are remount budgets, not freshness targets — the trade event is the
 * freshness path. Evidence gets the longer one because its slowest-moving parts
 * (the agents' written opinions, the 60-day series) do not move on a trade at
 * all; only the believer roster does.
 */
export const MARKET_CHANGE_STALE_MS = 30_000;
export const EVIDENCE_STALE_MS = 60_000;

/**
 * The deck's core payload: current prices plus the % move over every window.
 *
 * PER-MARKET KEY, ALWAYS. Carrying one market's result into another's panel
 * would paint the wrong numbers under the right title, so nothing here bridges
 * across ids — the scene holds the whole previous market instead.
 */
export function marketChangeQO(marketId: number) {
  return queryOptions({
    queryKey: ["market-change", marketId] as const,
    queryFn: () => getMarketChange({ data: { id: marketId } }),
    staleTime: MARKET_CHANGE_STALE_MS,
  });
}

/** Who actually holds this market, what the price did, and what the agents said. */
export function evidenceQO(marketId: number) {
  return queryOptions({
    queryKey: ["evidence", marketId] as const,
    queryFn: () => getMarketEvidence({ data: { marketId } }),
    staleTime: EVIDENCE_STALE_MS,
  });
}
