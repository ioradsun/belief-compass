/**
 * `/api/public/home-snapshot` — THE PUBLISHED FRONT DOOR.
 *
 * One versioned, paint-only snapshot of Explore + Insider + the first markets'
 * numbers, served so the app can read a single edge-cacheable object instead of
 * assembling the home screen from live queries. It NEVER ranks or aggregates on
 * the request path: a background warmer rebuilds the snapshot, and this endpoint
 * hands back whatever the warm slot or durable row holds. A cold isolate the
 * warmer has not reached builds once (shared and bounded) and persists, so the
 * next reader — here or in SSR — gets a row rather than a build.
 *
 * CACHEABLE BY CONTRACT. A weak ETag over (version, copyVersion, generatedAt)
 * lets a CDN or the browser hold the payload and revalidate cheaply — a 304 with
 * no body when nothing changed — and `stale-while-revalidate` lets an old
 * snapshot paint while a fresh one is fetched. Public and anonymous by
 * construction: there is nothing viewer-specific in it, so one cached copy is
 * correct for everyone. Encoding is the platform's job; `Vary` keeps a gzip copy
 * from being served to a client that asked for br.
 */
import { createFileRoute } from "@tanstack/react-router";

/**
 * Fresh for a few seconds, usable for a minute while a new one is fetched. The
 * warmer keeps the underlying row far fresher than this; these bounds only cap
 * how long an edge copy may lag, never how fresh the snapshot itself is.
 */
const CACHE_CONTROL = "public, max-age=10, stale-while-revalidate=60";

export const Route = createFileRoute("/api/public/home-snapshot")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { readOrBuildHomeSnapshot, homeSnapshotETag } = await import(
          "@/lib/home-snapshot.server"
        );
        const snap = await readOrBuildHomeSnapshot().catch(() => null);

        if (!snap) {
          // Nothing to publish yet. Tell caches not to hold the empty answer;
          // the client falls back to its normal per-surface fetches.
          return new Response(JSON.stringify({ error: "unavailable" }), {
            status: 503,
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "no-store, must-revalidate",
            },
          });
        }

        const etag = homeSnapshotETag(snap);
        if (request.headers.get("if-none-match") === etag) {
          return new Response(null, {
            status: 304,
            headers: { ETag: etag, "Cache-Control": CACHE_CONTROL },
          });
        }

        return new Response(JSON.stringify(snap), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            ETag: etag,
            "Cache-Control": CACHE_CONTROL,
            Vary: "Accept-Encoding",
          },
        });
      },
    },
  },
});
