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
import { markWashTrades } from "@/lib/wash-marker.server";

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

        // KEEP QUIET MARKETS EVALUATABLE. Every other enqueue is activity-driven,
        // so in a lull this queue drains empty, `ids` below is [], and
        // emitStoryEvents returns at its first line — the tape stops having
        // anything to say precisely when trading pauses. Worse, an unrefreshed
        // market_state never slides its 24h windows, so the story INPUTS freeze
        // too. This sweeps the few oldest still-active markets back in, ahead of
        // the claim so they are refreshed and evaluated on this same tick.
        let sweptStale = 0;
        let sweepError: string | null = null;
        try {
          const { data, error } = await sb.rpc("enqueue_stale_markets", {
            p_limit: 25,
            p_active_days: 30,
          });
          if (error) throw new Error(error.message);
          sweptStale = Number(data ?? 0) || 0;
        } catch (e) {
          // Same rule as every other step here: non-critical, but never silent.
          // If this stops working the symptom is subtle — the feed just goes
          // quiet — so it has to leave a trace rather than look like a slow day.
          sweepError = e instanceof Error ? e.message : String(e);
          console.error("[market-refresher] enqueue_stale_markets failed:", sweepError);
        }

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
        let transitionsError: string | null = null;
        try {
          const ids = out.results.filter((r) => r.ok).map((r) => r.market);
          transitionsEmitted = await emitStoryEvents(sb, ids);
        } catch (e) {
          // NEVER SILENTLY. A bare `catch {}` here meant this could fail on
          // every cycle for weeks while the job kept reporting ok:true — and it
          // did: zero market_transition rows had ever been written. Emitting is
          // still non-critical and must not block the refresh, but a failure now
          // leaves a trace in the response and the logs.
          transitionsError = e instanceof Error ? e.message : String(e);
          console.error("[market-refresher] emitStoryEvents failed:", transitionsError);
        }

        // Who is still holding, told as one story per (market, side) when a group
        // crosses a duration rung. Same events table, same feed — this is what
        // keeps a quiet market inhabited without inventing any movement.
        let cohortsEmitted = 0;
        let cohortsError: string | null = null;
        let wash: Awaited<ReturnType<typeof markWashTrades>> | null = null;
        let washError: string | null = null;
        try {
          // NO market filter. A duration milestone is driven by the CLOCK, not
          // by trading: scoping this to the markets we just refreshed meant a
          // quiet market's 30-day cohort could never be noticed, which is
          // exactly backwards — cohorts exist to make quiet markets inhabited.
          cohortsEmitted = await emitConvictionCohorts(null, sb);
        } catch (e) {
          cohortsError = e instanceof Error ? e.message : String(e);
          console.error("[market-refresher] emitConvictionCohorts failed:", cohortsError);
        }

        // Record which trades expressed no belief, so the aggregates exclude
        // exactly what the feed excludes. Runs BEFORE nothing in particular —
        // it is idempotent and its own scan window — but it must report itself,
        // because a marker that silently stops leaves the scoreboard drifting
        // away from the tape with no signal that it happened.
        try {
          wash = await markWashTrades(sb);
        } catch (e) {
          washError = e instanceof Error ? e.message : String(e);
          console.error("[market-refresher] markWashTrades failed:", washError);
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
          transitions_error: transitionsError,
          cohorts_error: cohortsError,
          sweep_error: sweepError,
          wash_error: washError,
          wash,
          // Should be non-zero on a quiet tick — that is the whole point of it.
          stale_markets_swept: sweptStale,
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
