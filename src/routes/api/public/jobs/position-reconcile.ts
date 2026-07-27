/**
 * Job P2 — position reconciliation (nightly / rolling). Bearer-guarded.
 *
 * Bounded, resumable drift sweep: recomputes each pair's reducer-state hash from
 * canonical events and repairs any drift via rebuildPosition. Also the shadow
 * comparison primitive (incremental stored state vs authoritative full refold).
 * Processes the least-recently-reconciled pairs each run, so repeated bounded
 * runs cover the whole table over time.
 */
import { createFileRoute } from "@tanstack/react-router";
import { getServiceSupabase, assertIngestBearer } from "@/lib/service-supabase.server";
import { reconcileBatch } from "@/lib/positions/reconcile.server";

export const Route = createFileRoute("/api/public/jobs/position-reconcile")({
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
        const limit = Number(url.searchParams.get("limit") ?? "200");

        const m = await reconcileBatch(sb, limit);
        return Response.json({ ok: true, ...m, ms: Date.now() - started });
      },
    },
  },
});
