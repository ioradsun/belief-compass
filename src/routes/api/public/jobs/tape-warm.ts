/**
 * Job — warm the Insider tape.
 *
 * THE FIRST REAL VISITOR SHOULD NEVER PAY THE COLD BUILD. The durable seed is
 * keyed by COPY_VERSION (see insider/seed.server), so a deploy invalidates it
 * by design: the very next reader would otherwise be the one who pays for the
 * multi-query build while looking at a skeleton. A cheap ping on a short cron —
 * and immediately after a publish — builds the shared tape and leaves the seed
 * behind, so SSR always has something to paint.
 *
 * Bearer-guarded like every other job: this does real work and must not be
 * callable by anyone who finds the URL.
 */
import { createFileRoute } from "@tanstack/react-router";
import { assertIngestBearer } from "@/lib/service-supabase.server";
import { buildTape } from "@/lib/insider/build.server";
import { writeTapeSeed, type TapeResult } from "@/lib/insider/seed.server";

export const Route = createFileRoute("/api/public/jobs/tape-warm")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          assertIngestBearer(request);
        } catch (r) {
          return r instanceof Response ? r : new Response("err", { status: 500 });
        }
        const started = Date.now();
        try {
          // The shared question exactly: no wallet, no scope, no side, no delta.
          const built = (await buildTape({ limit: 120 })) as TapeResult;
          if (built.error) {
            return Response.json(
              { ok: false, error: built.error, ms: Date.now() - started },
              { status: 200 },
            );
          }
          await writeTapeSeed(built);
          return Response.json({
            ok: true,
            rows: built.rows.length,
            copyVersion: built.copyVersion,
            ms: Date.now() - started,
          });
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          console.error("[tape-warm] failed:", message);
          return Response.json({ ok: false, error: message, ms: Date.now() - started });
        }
      },
    },
  },
});
