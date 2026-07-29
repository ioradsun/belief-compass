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

        // Emit believer-milestone community events for any side that just crossed
        // a rung. Cheap scan of market_state; idempotent by source_key.
        const { data: milestones } = await sb.rpc("detect_believer_milestones");
        const milestonesEmitted = Number(milestones ?? 0) || 0;

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
          processed: out.processed,
          dirty_markets_remaining: remaining ?? 0,
          oldest_dirty_market_age_ms: oldestAgeMs,
          ms: Date.now() - started,
        });
      },
    },
  },
});
