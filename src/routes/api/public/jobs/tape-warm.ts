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
import { writeDeckSeed, DECK_SEED_MARKETS } from "@/lib/deck-seed.server";


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

          // THE OTHER TWO COLUMNS GET THE SAME TREATMENT. The centre panel's
          // seed (the first finished cards) and its deck core (the trade tape
          // every number on the card is rebuilt from) are keyed by COPY_VERSION
          // too, so a deploy empties them and the first real visitor would
          // otherwise pay for both builds while looking at a skeleton.
          let deck = 0;
          try {
            const { opportunityFeed } = await import("@/lib/opportunity-feed.server");
            const feed = await opportunityFeed({ window: "24h" });
            const ids = feed.items
              .filter((i) => i.kind === "market")
              .slice(0, DECK_SEED_MARKETS)
              .map((i) => (i as { onchainId: number }).onchainId);
            const { readMarketChange } = await import("@/lib/market-core.server");
            const cores = await Promise.all(
              ids.map(async (id) => [String(id), await readMarketChange(id)] as const),
            );
            const entries = Object.fromEntries(cores);
            await writeDeckSeed(entries);
            deck = cores.length;
          } catch (e) {
            // The feed/deck warm is an accelerator; never fail the tape for it.
            console.error("[tape-warm] deck warm failed:", e instanceof Error ? e.message : e);
          }

          return Response.json({
            ok: true,
            rows: built.rows.length,
            deck,
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
