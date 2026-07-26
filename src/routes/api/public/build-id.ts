import { createFileRoute } from "@tanstack/react-router";
import { BUILD_ID } from "@/lib/build-id";

/**
 * Public endpoint that returns the currently-deployed build id. The client
 * polls this every 60s and hard-reloads when the value changes, so the preview
 * never gets stuck on a stale ConvictionFeed/MarketFacts bundle.
 */
export const Route = createFileRoute("/api/public/build-id")({
  server: {
    handlers: {
      GET: async () =>
        new Response(JSON.stringify({ buildId: BUILD_ID }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store, must-revalidate",
          },
        }),
    },
  },
});
