/**
 * `/og/market/<id>` — the preview IMAGE for one market's share card.
 *
 * A share link is only as strong as its picture, so every market resolves to a
 * real image here:
 *   • a media market → its own uploaded image / link thumbnail (the dominant
 *     visual the spec asks for), streamed through so the crawler gets stable
 *     bytes rather than a short-lived signed URL;
 *   • everything else → the branded fallback (public/og/default.png).
 *
 * It NEVER 404s or errors out to a crawler — a broken image is worse than a
 * plain one — so every failure path falls back to the branded image. (A
 * synthetic per-market image with the question + YES/NO baked into the pixels
 * needs a font rasterizer the Cloudflare build can't take on yet; that's the one
 * deferred piece. The text card already carries that state in the meantime.)
 */
import { createFileRoute } from "@tanstack/react-router";
import { marketIdFromParam } from "@/domain/share";

// Media bytes are effectively immutable once uploaded; the fallback is static.
// Cache at the edge, but not forever, so a market that later gains media (or a
// swapped fallback) refreshes within the hour.
const CACHE = "public, max-age=1800, s-maxage=1800";

/** The branded fallback image, streamed from same-origin static assets. */
async function fallback(request: Request): Promise<Response> {
  try {
    const res = await fetch(new URL("/og/default.png", request.url).toString());
    if (res.ok) {
      return new Response(res.body, {
        status: 200,
        headers: { "Content-Type": "image/png", "Cache-Control": CACHE },
      });
    }
  } catch {
    /* fall through to the redirect below */
  }
  // Last resort: point the crawler straight at the static asset.
  return Response.redirect(new URL("/og/default.png", request.url).toString(), 302);
}

/** The market's own image URL, or null when it has none we can show. */
async function marketImageUrl(id: number): Promise<string | null> {
  const { serviceClient } = await import("@/lib/supabase-clients");
  const sb = serviceClient();
  const { data } = await sb
    .from("conviction_markets")
    .select("media, hidden, moderation_status, status")
    .eq("onchain_id", id)
    .maybeSingle();
  const row = data as {
    media?: { kind?: string; path?: string; image?: unknown } | null;
    hidden?: boolean | null;
    moderation_status?: string | null;
    status?: string | null;
  } | null;
  // Don't surface media for a hidden, blocked, or inactive market.
  if (!row || row.hidden || row.moderation_status === "blocked" || row.status !== "active") {
    return null;
  }
  const media = row.media ?? null;
  if (!media) return null;

  // An uploaded image lives in the private bucket — sign a short-lived URL we
  // read server-side (the crawler never sees it; we stream the bytes).
  if (media.kind === "image" && typeof media.path === "string" && media.path) {
    const { signMediaUrl } = await import("@/lib/market-create.server");
    return await signMediaUrl(media.path);
  }
  // A link market's preview image is already a public URL.
  if (media.kind === "link" && typeof media.image === "string" && media.image) {
    return media.image;
  }
  // Video / audio have no stored still frame → branded fallback.
  return null;
}

export const Route = createFileRoute("/og/market/$mid")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        try {
          const id = marketIdFromParam(params.mid);
          if (id == null) return await fallback(request);

          const url = await marketImageUrl(id);
          if (!url) return await fallback(request);

          const img = await fetch(url);
          const type = img.headers.get("content-type") ?? "";
          if (!img.ok || !type.startsWith("image/")) return await fallback(request);

          return new Response(img.body, {
            status: 200,
            headers: { "Content-Type": type, "Cache-Control": CACHE },
          });
        } catch {
          return await fallback(request);
        }
      },
    },
  },
});
