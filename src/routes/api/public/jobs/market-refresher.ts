/**
 * Job R1 — market read-model refresher. Bearer-guarded.
 *
 * Claims a bounded batch of dirty markets from market_refresh_queue (coalesced,
 * SKIP LOCKED so two workers never refresh the same market) and rebuilds each
 * market_state row from canonical sources. Failures re-enqueue. Reports queue lag.
 */
import { createFileRoute } from "@tanstack/react-router";
import { getServiceSupabase, assertIngestBearer } from "@/lib/service-supabase.server";
import { refreshDirtyBatch } from "@/lib/market-state/refresh-market.server";
import { emitStoryEvents } from "@/lib/story-event-emit.server";
import { emitConvictionCohorts } from "@/lib/conviction-cohort-emit.server";

export const Route = createFileRoute("/api/public/jobs/market-refresher")({
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
        const limit = Number(new URL(request.url).searchParams.get("limit") ?? "100");

        const out = await refreshDirtyBatch(sb, limit);

        // Emit community events off the just-refreshed counts: believer-rung
        // milestones and same-day tribe doublings. Both cheap scans of
        // market_state, idempotent by source_key.
        const [{ data: milestones }, { data: doublings }] = await Promise.all([
          sb.rpc("detect_believer_milestones"),
          sb.rpc("detect_tribe_doublings"),
        ]);
        const milestonesEmitted = Number(milestones ?? 0) || 0;
        const doublingsEmitted = Number(doublings ?? 0) || 0;

        // Market-wide state transitions ("YES is accelerating", "the market is
        // becoming divided", …) off the markets we just refreshed — persisted and
        // deduped so only genuinely-new, persistent Tier 1-2 states reach the feed.
        // Best-effort: a failure here must never block the refresh loop.
        let transitionsEmitted = 0;
        try {
          const ids = out.results.filter((r) => r.ok).map((r) => r.market);
          transitionsEmitted = await emitStoryEvents(sb, ids);
        } catch {
          /* transitions are non-critical; skip this cycle on error */
        }

        // Who is still holding, told as one story per (market, side) when a group
        // crosses a duration rung. Same events table, same feed — this is what
        // keeps a quiet market inhabited without inventing any movement.
        let cohortsEmitted = 0;
        try {
          const ids = out.results.filter((r) => r.ok).map((r) => r.market);
          cohortsEmitted = await emitConvictionCohorts(ids, sb);
        } catch {
          /* cohorts are non-critical; skip this cycle on error */
        }

        const { count: remaining } = await sb
          .from("market_refresh_queue")
          .select("*", { count: "exact", head: true });
        const { data: oldest } = await sb
          .from("market_refresh_queue")
          .select("requested_at")
          .order("requested_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        const oldestAgeMs = oldest?.requested_at
          ? Date.now() - new Date(oldest.requested_at as string).getTime()
          : 0;

        return Response.json({
          ok: true,
          markets_refreshed: out.ok,
          market_refresh_failures: out.failed,
          milestones_emitted: milestonesEmitted,
          tribe_doublings_emitted: doublingsEmitted,
          transitions_emitted: transitionsEmitted,
          cohortsEmitted,
          processed: out.processed,
          dirty_markets_remaining: remaining ?? 0,
          oldest_dirty_market_age_ms: oldestAgeMs,
          ms: Date.now() - started,
        });
      },
    },
  },
});
