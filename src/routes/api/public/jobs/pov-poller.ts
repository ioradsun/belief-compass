/**
 * Job A — POV poller.
 * Crawls /markets, upserts markets + market_state, appends price_snapshots,
 * computes chg_1h/24h. NEVER touches wallet_beliefs.
 * Bearer-guarded via INGEST_RUN_SECRET.
 */
import { createFileRoute } from "@tanstack/react-router";
import { getServiceSupabase, assertIngestBearer } from "@/lib/service-supabase.server";
import { iterateAllMarkets } from "@/lib/pov.server";
import { marketCreatedSourceKey } from "@/lib/events";
import { applyChainMarketStateFallback } from "@/lib/market-state/chain-fallback.server";
import { povHealth } from "@/lib/pov-health.server";

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
        const eventRows: Record<string, unknown>[] = [];
        let createdEvents = 0;
        let createdEventsSkippedNoTime = 0;

        let crawlError: string | null = null;
        let fallback: Awaited<ReturnType<typeof applyChainMarketStateFallback>> | null = null;

        try {
          try {
          for await (const m of iterateAllMarkets()) {
            if (!m.onChainMarketId) continue;
            seen++;
            marketRows.push({
              onchain_id: m.onChainMarketId,
              pov_uuid: m.id ?? null,
              title: m.title ?? null,
              pov_slug: m.slug ?? null,

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
              no_price_usd: m.noPriceUsd ?? null,
              money_yes_pct: m.yesPercentage ?? null,
            });
            // One canonical market_created event per market, EVER. The
            // deterministic source_key + insert-ignore-duplicates means repeated
            // polls of an unchanged market never produce a second event. We only
            // emit when POV gives an authoritative creation time — occurred_at
            // must be real event time, never ingestion time. Markets with no
            // source creation time are skipped (kept out of recency ranking) and
            // reported; see the report's deferred limitations.
            if (m.createdAt) {
              eventRows.push({
                source_key: marketCreatedSourceKey(m.onChainMarketId),
                source: "pov",
                kind: "market_created",
                market_id: String(m.onChainMarketId),
                wallet: m.author?.walletAddress?.toLowerCase() ?? null,
                occurred_at: m.createdAt,
                payload: { created_at_source: "pov" },
              });
            } else {
              createdEventsSkippedNoTime++;
            }
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
          } catch (e: unknown) {
            // POV is an external provider. When it is unreachable we do NOT fail
            // the job: nearly everything the app shows is derived from Base
            // contract events, so we substitute chain-derived money figures for
            // the stale POV-owned ones and still run the maintenance steps below.
            crawlError = e instanceof Error ? e.message : String(e);
            console.error("[pov-poller] POV crawl failed, degrading to chain data:", crawlError);
            fallback = await applyChainMarketStateFallback(sb);
          }

          // POV can return the same market twice inside one page window; Postgres
          // rejects an upsert batch that touches the same key twice, so collapse
          // to the last occurrence per key before writing.
          function dedupeBy<T extends Record<string, unknown>>(rows: T[], key: string): T[] {
            const m = new Map<string, T>();
            for (const r of rows) m.set(String(r[key]), r);
            return [...m.values()];
          }

          async function flush() {
            if (marketRows.length === 0) return;
            const m = await sb
              .from("markets")
              .upsert(dedupeBy(marketRows, "onchain_id"), { onConflict: "onchain_id" });
            if (m.error) throw m.error;
            const s = await sb
              .from("market_state")
              .upsert(dedupeBy(stateRows, "onchain_id"), { onConflict: "onchain_id" });
            if (s.error) throw s.error;
            // POV display changed → mark the read model pov-dirty (coalesced).
            const povMarketIds = marketRows.map((r) => Number(r.onchain_id));
            if (povMarketIds.length > 0) {
              await sb.rpc("enqueue_market_refresh", { p_market_ids: povMarketIds, p_kind: "pov" });
            }
            const p = await sb.from("price_snapshots").insert(snapshotRows);
            if (p.error && !String(p.error.message).includes("duplicate")) throw p.error;
            if (profileRows.length > 0) {
              const pr = await sb
                .from("profiles")
                .upsert(dedupeBy(profileRows, "wallet"), { onConflict: "wallet" });
              if (pr.error) throw pr.error;
            }
            if (eventRows.length > 0) {
              // Idempotent: on conflict (source_key) do nothing → exactly one
              // market_created event per market across all polls.
              const ev = await sb
                .from("events")
                .upsert(dedupeBy(eventRows, "source_key"), { onConflict: "source_key", ignoreDuplicates: true })
                .select("id");
              if (ev.error) throw ev.error;
              createdEvents += ev.data?.length ?? 0;
            }
            upserted += marketRows.length;
            marketRows.length = 0;
            stateRows.length = 0;
            snapshotRows.length = 0;
            profileRows.length = 0;
            eventRows.length = 0;
          }

          // Compute share-price performance from snapshots. This used to swallow
          // failures, which made stalled percentage changes look like a UI bug.
          const { error: chgErr } = await sb.rpc("recompute_price_changes");
          if (chgErr) throw chgErr;

          // Prune snapshots >30d
          await sb
            .from("price_snapshots")
            .delete()
            .lt("captured_at", new Date(Date.now() - 30 * 86_400_000).toISOString());

          // Snapshot the authoritative believers/capital totals so the deck can
          // read a true window-open baseline even when a busy market's trade tape
          // is truncated (see market_window_baselines). Best-effort: a missing RPC
          // (deploy landing before the migration) must never fail the poll.
          const { error: snapErr } = await sb.rpc("snapshot_market_state");
          if (snapErr) console.error("snapshot_market_state failed:", snapErr.message);
          await sb
            .from("market_state_snapshots")
            .delete()
            .lt("captured_at", new Date(Date.now() - 30 * 86_400_000).toISOString());

          return Response.json({
            ok: true,
            degraded: crawlError != null,
            pov_error: crawlError,
            chain_fallback: fallback,
            pov_health: povHealth(),
            seen,
            upserted,
            market_created_events_inserted: createdEvents,
            market_created_skipped_no_source_time: createdEventsSkippedNoTime,
            ms: Date.now() - started,
          });
        } catch (e: unknown) {
          const msg =
            e instanceof Error
              ? e.message
              : typeof e === "object" && e !== null
                ? JSON.stringify(e)
                : String(e);
          console.error("[pov-poller]", msg);
          return Response.json({ ok: false, error: msg, seen, upserted }, { status: 500 });
        }
      },
    },
  },
});
