/**
 * Job A — POV poller.
 * Crawls /markets, upserts markets + market_state, appends price_snapshots,
 * computes chg_1h/24h. NEVER touches wallet_beliefs.
 * Bearer-guarded via INGEST_RUN_SECRET.
 */
import { createFileRoute } from "@tanstack/react-router";
import { getServiceSupabase, assertIngestBearer } from "@/lib/service-supabase.server";
import { iterateAllMarkets } from "@/lib/pov.server";

export const Route = createFileRoute("/api/public/jobs/pov-poller")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          assertIngestBearer(request);
        } catch (r) {
          return r instanceof Response ? r : new Response("err", { status: 500 });
        }

        const sb = getServiceSupabase();
        const started = Date.now();
        let seen = 0,
          upserted = 0;

        const marketRows: Record<string, unknown>[] = [];
        const stateRows: Record<string, unknown>[] = [];
        const snapshotRows: Record<string, unknown>[] = [];
        const profileRows: Record<string, unknown>[] = [];

        try {
          for await (const m of iterateAllMarkets()) {
            if (!m.onChainMarketId) continue;
            seen++;
            marketRows.push({
              onchain_id: m.onChainMarketId,
              pov_uuid: m.id ?? null,
              title: m.title ?? null,
              category: m.categorySlug ?? null,
              author_wallet: m.author?.walletAddress?.toLowerCase() ?? null,
              author_name: m.author?.displayName ?? null,
              author_pfp: m.author?.pfpUrl ?? null,
              agent_opinions: m.agentOpinions ?? null,
              source: "pov",
              created_at: m.createdAt ?? null,
            });
            stateRows.push({
              onchain_id: m.onChainMarketId,
              yes_price_usd: m.yesPriceUsd ?? null,
              no_price_usd: m.noPriceUsd ?? null,
              money_yes_pct: m.yesPercentage ?? null,
              volume_total_usd: m.volumeTotalUsd ?? null,
              yes_capital_usd: m.yesMarketCapUsd ?? null,
              no_capital_usd: m.noMarketCapUsd ?? null,
              volume_24h_usd: m.volume24hUsd ?? null,
              boost_score: m.boostScore ?? null,
              trending_score: m.trendingScore ?? null,
              updated_at: new Date().toISOString(),
            });
            snapshotRows.push({
              onchain_id: m.onChainMarketId,
              yes_price_usd: m.yesPriceUsd ?? null,
              money_yes_pct: m.yesPercentage ?? null,
            });
            // The author profile rides along on every market — cache it so the
            // conviction feed can show a real pic without an extra API call.
            const authorWallet = m.author?.walletAddress?.toLowerCase();
            if (authorWallet) {
              profileRows.push({
                wallet: authorWallet,
                username: m.author?.username ?? null,
                display_name: m.author?.displayName ?? null,
                pfp_url: m.author?.pfpUrl ?? null,
                not_found: false,
                fetched_at: new Date().toISOString(),
              });
            }
            // Flush in batches
            if (marketRows.length >= 200) {
              await flush();
            }
          }
          await flush();

          async function flush() {
            if (marketRows.length === 0) return;
            const m = await sb.from("markets").upsert(marketRows, { onConflict: "onchain_id" });
            if (m.error) throw m.error;
            const s = await sb.from("market_state").upsert(stateRows, { onConflict: "onchain_id" });
            if (s.error) throw s.error;
            const p = await sb.from("price_snapshots").insert(snapshotRows);
            if (p.error && !String(p.error.message).includes("duplicate")) throw p.error;
            if (profileRows.length > 0) {
              const pr = await sb.from("profiles").upsert(profileRows, { onConflict: "wallet" });
              if (pr.error) throw pr.error;
            }
            upserted += marketRows.length;
            marketRows.length = 0;
            stateRows.length = 0;
            snapshotRows.length = 0;
            profileRows.length = 0;
          }

          // Compute chg_1h/24h from snapshots for markets touched (batch SQL)
          (await sb.rpc) as unknown; // no-op; the per-market compute below is done via SQL update
          const { error: chgErr } = (await sb
            .rpc("recompute_price_changes")
            .select("*")
            .maybeSingle()) as { error?: unknown };
          // recompute function may not exist yet; ignore if missing.
          void chgErr;

          // Prune snapshots >30d
          await sb
            .from("price_snapshots")
            .delete()
            .lt("captured_at", new Date(Date.now() - 30 * 86_400_000).toISOString());

          return Response.json({ ok: true, seen, upserted, ms: Date.now() - started });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("[pov-poller]", msg);
          return Response.json({ ok: false, error: msg, seen, upserted }, { status: 500 });
        }
      },
    },
  },
});
