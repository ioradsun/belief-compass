/**
 * Job A1 — market meaning analyser. Bearer-guarded.
 *
 * Understands each market ONCE, at ingestion, and stores the result. Reruns only
 * when the question, description, media or engine version change. The feed never
 * waits on this: an unanalysed market still ranks, just with neutral quality.
 */
import { createFileRoute } from "@tanstack/react-router";
import { assertIngestBearer } from "@/lib/service-supabase.server";
import { analyseMarket, pendingAnalysisTargets } from "@/lib/feed/market-analysis.server";

const BATCH = 6; // bounded: two AI calls per market, so a tick stays short

export const Route = createFileRoute("/api/public/jobs/market-analyzer")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          assertIngestBearer(request);
        } catch (r) {
          return r instanceof Response ? r : new Response("err", { status: 500 });
        }

        const targets = await pendingAnalysisTargets(BATCH);
        let ready = 0;
        let failed = 0;
        for (const t of targets) {
          const status = await analyseMarket(t);
          if (status === "ready") ready++;
          else failed++;
        }
        return Response.json({ ok: true, considered: targets.length, ready, failed });
      },
    },
  },
});
