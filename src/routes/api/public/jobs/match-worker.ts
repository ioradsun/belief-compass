/**
 * Job M2 — bounded viewer-match refresh worker (Phase 8). Bearer-guarded.
 *
 * Drains the match_queue: for each pending viewer, recomputes the bounded
 * viewer_dna_cache via computeViewerDna (shared-market candidates → exact
 * DNA over a bounded pool), then marks the row done. This is the ONLY background
 * matcher — there is no global all-wallet pass. connect + the feed's cache-miss
 * path enqueue here so the scan never blocks a request.
 */
import { createFileRoute } from "@tanstack/react-router";
import { getServiceSupabase, assertIngestBearer } from "@/lib/service-supabase.server";
import { computeViewerDna } from "@/lib/dna/compute-viewer-dna.server";

const BATCH = 10; // wallets processed per tick — bounded so a tick stays short

export const Route = createFileRoute("/api/public/jobs/match-worker")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          assertIngestBearer(request);
        } catch (r) {
          return r instanceof Response ? r : new Response("err", { status: 500 });
        }

        const sb = getServiceSupabase();

        const { data: pending } = await sb
          .from("match_queue")
          .select("wallet")
          .eq("pending", true)
          .order("enqueued_at", { ascending: true })
          .limit(BATCH);

        const wallets = (pending ?? []).map((r) => String(r.wallet));
        if (wallets.length === 0) return Response.json({ ok: true, processed: 0 });

        let processed = 0;
        let failed = 0;
        for (const wallet of wallets) {
          const startedAt = new Date().toISOString();
          try {
            await computeViewerDna(wallet);
            // Mark done. Guard on pending=true so a re-enqueue that arrived while
            // we were computing stays pending and gets picked up next tick.
            await sb
              .from("match_queue")
              .update({ pending: false, started_at: startedAt, done_at: new Date().toISOString() })
              .eq("wallet", wallet);
            processed++;
          } catch (e: unknown) {
            failed++;
            const msg = e instanceof Error ? e.message : String(e);
            // Leave pending=true so it retries; record the error and bump attempts.
            const { data: cur } = await sb
              .from("match_queue")
              .select("attempts")
              .eq("wallet", wallet)
              .maybeSingle();
            await sb
              .from("match_queue")
              .update({
                started_at: startedAt,
                attempts: Number(cur?.attempts ?? 0) + 1,
                last_error: msg.slice(0, 500),
              })
              .eq("wallet", wallet);
          }
        }

        return Response.json({ ok: true, processed, failed });
      },
    },
  },
});
