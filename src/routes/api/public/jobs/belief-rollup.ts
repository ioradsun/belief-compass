/**
 * Job C — position EVALUATOR (Phase 3). Bearer-guarded.
 *
 * This job owns ONLY price- and time-driven evaluated state. It reads current POV
 * prices from market_state, runs the pure evaluate() over affected wallet_beliefs
 * rows, and updates stance/stance_side/conviction/days_held (evaluated fields) —
 * plus the GROUP BY onchain_id market_state believer counts, People%, divergence,
 * velocity, new_believers_1h. It NEVER reloads trade history, never calls
 * applyTrade(), and never advances the position cursor or trade-driven reducer
 * fields — those are owned incrementally by apply-events.server.ts (via the chain
 * poller) and repaired by the targeted rebuilder. It never emits feed_events.
 *
 * IT IS ALSO THE MARKED-VALUE WRITER. `evaluate()` returns yes_value / no_value
 * — shares at the current side price — and this job used to compute them and
 * then persist only stance/conviction/days_held, dropping the valuation on the
 * floor. `wallet_beliefs.yes_value_usd` therefore had six readers and zero
 * writers, every one of them doing `Number(null) || 0` and carrying on with a
 * confident zero. That silently emptied conviction cohorts, the standing-fact
 * pool, whale detection, and the dashboard's held count.
 *
 * So the value is now persisted with its PROVENANCE (`value_source`,
 * `value_updated_at`), which is what lets a reader tell a live measurement from
 * a stale one from a cost-basis fallback (src/domain/position-value). And it is
 * written only when a real price exists: a market with no price leaves the last
 * known value alone rather than overwriting it with zero, because "no price
 * today" is not "this position is worthless".
 */
import { createFileRoute } from "@tanstack/react-router";
import { getServiceSupabase, assertIngestBearer } from "@/lib/service-supabase.server";
import { evaluate, type BeliefRow } from "@/domain/domain";

const rowToBeliefRow = (r: Record<string, unknown>): BeliefRow => ({
  yes_shares: Number(r.yes_shares ?? 0),
  no_shares: Number(r.no_shares ?? 0),
  yes_cost: Number(r.yes_cost ?? 0),
  no_cost: Number(r.no_cost ?? 0),
  expressed_side: (r.expressed_side as BeliefRow["expressed_side"]) ?? "INACTIVE",
  directional_since: r.directional_since ? new Date(r.directional_since as string) : null,
  first_backed_at: r.first_backed_at ? new Date(r.first_backed_at as string) : null,
  last_trade_at: r.last_trade_at ? new Date(r.last_trade_at as string) : null,
  // Not read by evaluate(); present to satisfy the canonical row shape.
  last_directional_side: null,
});

export const Route = createFileRoute("/api/public/jobs/belief-rollup")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          assertIngestBearer(request);
        } catch (r) {
          return r instanceof Response ? r : new Response("err", { status: 500 });
        }

        const url = new URL(request.url);
        const mode = url.searchParams.get("mode") ?? "incremental"; // incremental|full|sweep
        const sb = getServiceSupabase();
        const now = new Date();

        // Choose affected market set
        let marketIds: number[];
        // An explicit market list, for repairing a known market without a
        // whole-corpus sweep.
        const only = (url.searchParams.get("markets") ?? "")
          .split(",")
          .map((s) => Number(s.trim()))
          .filter((n) => Number.isFinite(n) && n > 0);
        if (only.length > 0) {
          marketIds = only;
        } else if (mode === "full" || mode === "sweep") {
          const { data } = await sb.from("markets").select("onchain_id");
          marketIds = (data ?? []).map((r) => Number(r.onchain_id));
        } else {
          // Markets with a canonical trade in the last 2m, by EVENT time. Reads
          // the canonical events log (the deprecated trades.ts is no longer
          // written and would select nothing); is_canonical excludes orphans.
          const cutoff = new Date(Date.now() - 2 * 60_000).toISOString();
          const { data } = await sb
            .from("events")
            .select("market_id")
            .eq("is_canonical", true)
            .eq("kind", "trade")
            .gte("occurred_at", cutoff);
          marketIds = [...new Set((data ?? []).map((r) => Number(r.market_id)))];
        }

        if (marketIds.length === 0) return Response.json({ ok: true, markets: 0, marked: 0 });

        // How many markets got a real valuation this run. "Ran but marked
        // nothing" and "marked 400" are different worlds and an ok:true cannot
        // tell them apart — which is how the missing writer hid for weeks.
        let marked = 0;

        // Denylist for believer counts
        const { data: deny } = await sb.from("wallet_denylist").select("wallet");
        const denylist = new Set((deny ?? []).map((d) => (d.wallet as string).toLowerCase()));

        // Load prices for all affected markets
        const { data: states } = await sb
          .from("market_state")
          .select("onchain_id, yes_price_usd, no_price_usd, money_yes_pct")
          .in("onchain_id", marketIds);
        const priceMap = new Map(
          (states ?? []).map((s) => [
            Number(s.onchain_id),
            {
              yesPriceUsd: Number(s.yes_price_usd ?? 0),
              noPriceUsd: Number(s.no_price_usd ?? 0),
              moneyYesPct: Number(s.money_yes_pct ?? 0),
            },
          ]),
        );

        // Evaluate wallet_beliefs and rebuild market_state per market
        for (const mid of marketIds) {
          const p = priceMap.get(mid);
          if (!p) continue;
          const { data: beliefs } = await sb
            .from("wallet_beliefs")
            .select("*")
            .eq("onchain_id", mid);

          // A real price on AT LEAST ONE side is enough to value the market.
          // Requiring both was silently fatal for young markets — and for every
          // market created inside this app, where only the traded side has an
          // observed price. A side nobody has bought holds no shares for anyone,
          // so its missing price cannot understate a single position.
          const canMark = p.yesPriceUsd > 0 || p.noPriceUsd > 0;
          const updates: Record<string, unknown>[] = [];
          let by = 0,
            bn = 0,
            bm = 0;
          for (const r of beliefs ?? []) {
            const row = rowToBeliefRow(r as Record<string, unknown>);
            const v = evaluate(row, { yesPriceUsd: p.yesPriceUsd, noPriceUsd: p.noPriceUsd }, now);
            updates.push({
              wallet: r.wallet,
              onchain_id: mid,
              stance: v.stance,
              stance_side: v.stance_side,
              conviction: v.conviction,
              days_held: v.days_held,
              // The valuation, with where it came from and when. Omitted whole
              // when unpriced — never written as a zero.
              ...(canMark
                ? {
                    yes_value_usd: v.yes_value,
                    no_value_usd: v.no_value,
                    value_source: "marked",
                    value_updated_at: now.toISOString(),
                  }
                : {}),
              updated_at: now.toISOString(),
            });
            if (denylist.has((r.wallet as string).toLowerCase())) continue;
            if (v.stance_side === "YES") by++;
            else if (v.stance_side === "NO") bn++;
            else if (v.stance_side === "MIXED") bm++;
          }
          if (canMark && updates.length > 0) marked++;
          if (updates.length > 0) {
            // Upsert in chunks to avoid huge payloads
            for (let i = 0; i < updates.length; i += 500) {
              await sb
                .from("wallet_beliefs")
                .upsert(updates.slice(i, i + 500), { onConflict: "wallet,onchain_id" });
            }
          }

          const total = by + bn;
          const peoplePct = total > 0 ? (by / total) * 100 : null;
          const divergence =
            peoplePct != null && p.moneyYesPct != null ? Math.abs(p.moneyYesPct - peoplePct) : null;

          // Velocity: canonical trade EVENTS in the last 5m by event time. Reads
          // the events log (not the trades projection); is_canonical excludes
          // reorg-orphaned trades. Phase 6.5: trades is no longer read here.
          const t5m = new Date(Date.now() - 5 * 60_000).toISOString();
          const { count: velocity } = await sb
            .from("events")
            .select("*", { count: "exact", head: true })
            .eq("is_canonical", true)
            .eq("kind", "trade")
            .eq("market_id", String(mid))
            .gte("occurred_at", t5m);

          // New believers in last hour: count of canonical BUY trade events by
          // event time. Reads the events log (feed_events no longer carries
          // trades); is_canonical excludes reorg-orphaned trades.
          const t1h = new Date(Date.now() - 3600_000).toISOString();
          const { count: nb1h } = await sb
            .from("events")
            .select("*", { count: "exact", head: true })
            .eq("is_canonical", true)
            .eq("kind", "trade")
            .eq("action", "BUY")
            .eq("market_id", String(mid))
            .gte("occurred_at", t1h);

          await sb
            .from("market_state")
            .update({
              believers_yes: by,
              believers_no: bn,
              believers_mixed: bm,
              people_yes_pct: peoplePct,
              divergence,
              velocity_5m: velocity ?? 0,
              new_believers_1h: nb1h ?? 0,
              updated_at: now.toISOString(),
            })
            .eq("onchain_id", mid);
        }

        return Response.json({ ok: true, markets: marketIds.length, marked, mode });
      },
    },
  },
});
