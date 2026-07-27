/**
 * Job M — batch DNA matcher. Bearer-guarded, called by cron.
 * Precomputes every wallet's Tribe + Circles into wallet_matches.
 */
import { createFileRoute } from "@tanstack/react-router";
import { getServiceSupabase, assertIngestBearer } from "@/lib/service-supabase.server";
import { recomputeAllDna } from "@/lib/dna-batch.server";

export const Route = createFileRoute("/api/public/jobs/dna-matcher")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          assertIngestBearer(request);
        } catch (r) {
          return r instanceof Response ? r : new Response("err", { status: 500 });
        }
        try {
          const result = await recomputeAllDna(getServiceSupabase());
          return Response.json({ ok: true, ...result });
        } catch (e) {
          return Response.json(
            { ok: false, error: e instanceof Error ? e.message : String(e) },
            { status: 500 },
          );
        }
      },
    },
  },
});
