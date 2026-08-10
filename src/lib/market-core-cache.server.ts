/**
 * ONE MARKET'S READS ARE THE SAME QUESTION FOR EVERY READER — so build them once.
 *
 * This is the Insider source-cache pattern (see `insider/source-cache.server`)
 * applied to the centre panel's three expensive per-market reads: the deck core
 * (`market-change`, a 1,000-row trade replay plus a `market_state` read), the
 * believer evidence (four service-client queries incl. a 200-row
 * `wallet_beliefs` read and a 60-day series RPC) and the window baselines RPC.
 *
 * None of the three take a wallet: two readers on the same market are asking
 * one question, and before this each paid for their own answer. The key is the
 * whole question — kind + market id — so nothing can bridge one market's numbers
 * into another's panel.
 *
 * The cache is an ACCELERATOR, NEVER A GATE: any failure falls through to the
 * caller's own read, in the caller's shape.
 */
import { swrCache } from "@/lib/server-cache";

/**
 * Short enough that a trade shows up almost immediately (the realtime
 * coordinator invalidates the client cache on the trade itself, so this only
 * bounds how stale the answer that arrives can be), long enough that a burst of
 * readers on the same market is one build.
 */
export const MARKET_CORE_TTL_MS = 10_000;

export function marketCoreKey(kind: string, marketId: number): string {
  return `market:${kind}:${marketId}`;
}

export async function sharedMarketRead<T>(
  kind: string,
  marketId: number,
  read: () => Promise<T>,
): Promise<T> {
  try {
    return await swrCache(marketCoreKey(kind, marketId), { ttlMs: MARKET_CORE_TTL_MS }, read);
  } catch {
    return read();
  }
}
