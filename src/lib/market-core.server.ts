/**
 * THE CENTRE PANEL'S CORE READ, off the server-function file so a job can use it.
 *
 * `getMarketChange` used to own this body. A background warmer cannot call a
 * server function (that is an RPC stub on the client and outside the worker's
 * manifest on the server), so the read lives here and both the server function
 * and `/api/public/jobs/tape-warm` call the same code — the tape's arrangement,
 * applied to the deck.
 *
 * Viewer-blind, so it goes through the shared per-market cache: a burst of
 * readers on the same market is one trade-tape replay, not one each.
 */
import { publicClient, serviceClient } from "@/lib/supabase-clients";
import { readLatestTradeEvents } from "@/lib/events.functions";
import { accelerationFrom } from "@/domain/feed/score";
import { weiToEth } from "@/domain/money";
import type { TapeTrade } from "@/domain/conviction-series";
import type { MarketChange } from "@/lib/markets.functions";
import { sharedMarketRead } from "@/lib/market-core-cache.server";

export async function readMarketChange(id: number): Promise<MarketChange> {
  return sharedMarketRead("change", id, async () => {
    // ONE read: the canonical trade tape. Every windowed number the deck shows is
    // rebuilt from it client-side (marketBook + conviction-series), so there is no
    // second, precomputed source of truth to drift from. `amount_eth`/`price` are
    // wei (strings on the wire, so precision survives); scaled to whole ETH here.
    // Server-side read: the public events policy only exposes the last 3 days,
    // which would silently truncate the tape the book is rebuilt from.
    const trades = await readLatestTradeEvents(serviceClient(), {
      marketIds: [id],
      limit: 1000,
    });
    const tape: TapeTrade[] = [];
    for (const t of trades) {
      const side = t.side === "YES" || t.side === "NO" ? t.side : null;
      const action = t.action === "SELL" ? "SELL" : t.action === "BUY" ? "BUY" : null;
      if (!side || !action || !t.wallet) continue;
      const wei = Number(t.amount_eth ?? 0);
      const eth = weiToEth(wei);
      const at = new Date(t.occurred_at).getTime();
      const priceWei = t.price == null ? null : Number(t.price);
      // Chain order inside the block. Whole blocks share one occurred_at, so
      // without this a SELL can be replayed before the BUY it closes and the
      // wallet keeps phantom shares (and phantom believer/capital totals).
      const blk = Number(t.block_number ?? 0);
      const lg = Number(t.log_index ?? 0);
      const seq = Number.isFinite(blk) && Number.isFinite(lg) ? blk * 100_000 + Math.max(0, lg) : 0;
      tape.push({
        // Short, stable key — enough to count distinct believers, and nothing
        // more than the feed already publishes.
        w: t.wallet.slice(0, 10),
        side,
        action,
        eth,
        price: priceWei == null ? null : weiToEth(priceWei),
        t: at,
        seq,
      });
    }

    // The ranker's acceleration baseline, surfaced through this canonical path so
    // the center's state-transition emitter reads "× normal" from the same source
    // of truth. One tiny market_state read; the multiple is computed by the shared
    // accelerationFrom helper — never a second client-side baseline.
    let acceleration: number | null = null;
    const { data: ms } = await publicClient()
      .from("market_state")
      .select("trade_count_1h, trade_count_24h, velocity_5m")
      .eq("onchain_id", id)
      .maybeSingle();
    if (ms) {
      const r = ms as Record<string, unknown>;
      acceleration = accelerationFrom(
        Number(r.trade_count_1h ?? 0) || 0,
        Number(r.trade_count_24h ?? 0) || 0,
        Number(r.velocity_5m ?? 0) || 0,
      );
    }

    return { tape, acceleration };
  });
}
