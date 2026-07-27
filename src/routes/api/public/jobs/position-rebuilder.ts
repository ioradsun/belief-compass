/**
 * Job P1 — position rebuilder + recovery. Bearer-guarded.
 *
 * Two bounded repair passes on wallet_beliefs:
 *   1. rebuildDirtyBatch — pairs marked needs_rebuild (reorg / late / out-of-order
 *      / version-conflict) are refolded from canonical events (idempotent).
 *   2. recoverPendingPositions — CLEAN pairs whose cursor is behind canonical
 *      history (an event persisted but its position write never happened, e.g. a
 *      crash) are advanced incrementally. Makes ingestion durable.
 *
 * Idempotent + bounded; safe to run on a schedule or as standalone recovery.
 */
import { createFileRoute } from "@tanstack/react-router";
import { getServiceSupabase, assertIngestBearer } from "@/lib/service-supabase.server";
import { rebuildDirtyBatch } from "@/lib/positions/rebuild-position.server";
import { recoverPendingPositions } from "@/lib/positions/apply-events.server";

export const Route = createFileRoute("/api/public/jobs/position-rebuilder")({
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

        const url = new URL(request.url);
        const dirtyLimit = Number(url.searchParams.get("dirty") ?? "100");
        const recoverLimit = Number(url.searchParams.get("recover") ?? "200");

        const rebuilt = await rebuildDirtyBatch(sb, dirtyLimit);
        const recovered = await recoverPendingPositions(sb, recoverLimit);

        // Remaining dirty count + oldest dirty age for observability.
        const { count: dirtyRemaining } = await sb
          .from("wallet_beliefs")
          .select("*", { count: "exact", head: true })
          .eq("needs_rebuild", true);
        const { data: oldest } = await sb
          .from("wallet_beliefs")
          .select("rebuild_requested_at")
          .eq("needs_rebuild", true)
          .order("rebuild_requested_at", { ascending: true, nullsFirst: true })
          .limit(1)
          .maybeSingle();
        const oldestAgeMs = oldest?.rebuild_requested_at
          ? Date.now() - new Date(oldest.rebuild_requested_at as string).getTime()
          : 0;

        return Response.json({
          ok: true,
          rebuilt: { processed: rebuilt.processed, ok: rebuilt.ok, failed: rebuilt.failed },
          recovered: {
            pairs_received: recovered.pairs_received,
            events_applied: recovered.events_applied,
            positions_updated: recovered.positions_updated,
            positions_marked_dirty: recovered.positions_marked_dirty,
            full_history_reads_hot_path: recovered.full_history_reads_hot_path,
          },
          dirty_position_count: dirtyRemaining ?? 0,
          oldest_dirty_position_age_ms: oldestAgeMs,
          ms: Date.now() - started,
        });
      },
    },
  },
});
