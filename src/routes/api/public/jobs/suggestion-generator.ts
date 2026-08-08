/**
 * Job S1 — "The House has an idea" generator. Bearer-guarded.
 *
 * Runs ahead of the viewer: picks a bounded set of wallets that recently
 * answered a market and have no live idea waiting, then generates, validates
 * and stores one suggestion each. Nothing in the feed ever waits on this — if
 * the model is down the job simply stores nothing and normal markets continue.
 */
import { createFileRoute } from "@tanstack/react-router";
import { assertIngestBearer } from "@/lib/service-supabase.server";
import { generateSuggestionFor, walletsNeedingSuggestions } from "@/lib/market-suggestion.server";

const BATCH = 8; // bounded: one AI call per wallet, so a tick stays short

export const Route = createFileRoute("/api/public/jobs/suggestion-generator")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          assertIngestBearer(request);
        } catch (r) {
          return r instanceof Response ? r : new Response("err", { status: 500 });
        }

        const wallets = await walletsNeedingSuggestions(BATCH);
        let stored = 0;
        const skipped: Record<string, number> = {};
        const note = (reason: string) => {
          skipped[reason] = (skipped[reason] ?? 0) + 1;
        };

        for (const wallet of wallets) {
          try {
            const { id, reason } = await generateSuggestionFor(wallet);
            if (id) stored++;
            else note(reason ?? "unknown");
          } catch {
            note("threw");
          }
        }
        return Response.json({
          ok: true,
          considered: wallets.length,
          stored,
          skipped: Object.values(skipped).reduce((a, b) => a + b, 0),
          skippedBy: skipped,
        });
      },
    },
  },
});
