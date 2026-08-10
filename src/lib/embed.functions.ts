/**
 * Embed resolution — the server-side half of the paste-a-link flow.
 *
 * Two jobs, both deliberately small:
 *   1. `resolveEmbed` — re-parse the pasted URL with the SAME gate the client
 *      uses (never trust the client's parse) and fetch the platform's public oEmbed for
 *      title / author / thumbnail. Metadata is best-effort: an embed renders
 *      without it, and a failed oEmbed must never block market creation.
 *   2. `attachMarketEmbed` — store the canonical URL + that metadata on the
 *      draft. Nothing is downloaded, re-hosted or transcoded.
 */
import { createServerFn } from "@tanstack/react-start";
import { parseEmbed, instantThumbnail, type EmbedMedia, type EmbedPlatform } from "@/lib/embed";

/** Public oEmbed endpoints for the platforms that play inline. */
const OEMBED: Partial<Record<EmbedPlatform, (url: string) => string>> = {
  youtube: (u) => `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(u)}`,
  spotify: (u) => `https://open.spotify.com/oembed?url=${encodeURIComponent(u)}`,
  x: (u) =>
    `https://publish.twitter.com/oembed?omit_script=1&dnt=true&url=${encodeURIComponent(u)}`,
};

async function withTimeout(url: string, ms = 4000): Promise<Response | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": "ConvictionBot/1.0", Accept: "application/json" },
    });
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export const resolveEmbed = createServerFn({ method: "POST" })
  .inputValidator((data: { url: string }) => ({ url: String(data.url ?? "").slice(0, 600) }))
  .handler(async ({ data }): Promise<{ media: EmbedMedia | null; error: string | null }> => {
    const parsed = parseEmbed(data.url);
    if (!parsed) {
      return {
        media: null,
        error: "Only YouTube, X and Spotify links are supported — they play inline.",
      };
    }

    let title: string | null = null;
    let author: string | null = null;
    let thumbnail: string | null = instantThumbnail(parsed);

    const endpoint = OEMBED[parsed.platform]?.(parsed.url);
    if (endpoint) {
      const res = await withTimeout(endpoint);
      if (res?.ok) {
        try {
          const j = (await res.json()) as Record<string, unknown>;
          const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
          title = str(j.title);
          author = str(j.author_name);
          const thumb = str(j.thumbnail_url);
          // Only ever keep https image URLs — they are rendered as <img src>.
          if (thumb && thumb.startsWith("https://")) thumbnail = thumb;
        } catch {
          /* metadata is optional */
        }
      }
    }

    return { media: { kind: "embed", ...parsed, title, author, thumbnail }, error: null };
  });

/** Store the resolved embed against a draft market. */
export const attachMarketEmbed = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { wallet: string; token: string; questionId: string; url: string }) => data,
  )
  .handler(async ({ data }) => {
    const { assertWalletOwnership } = await import("@/lib/wallet-session.server");
    const wallet = await assertWalletOwnership(data.wallet, data.token);
    const resolved = await resolveEmbed({ data: { url: data.url } });
    if (!resolved.media) throw new Error(resolved.error ?? "Unsupported link.");
    const m = resolved.media;
    const { serviceClient } = await import("@/lib/supabase-clients");
    const db = serviceClient();
    const { error } = await db
      .from("conviction_markets")
      .update({
        media: {
          kind: "embed",
          platform: m.platform,
          url: m.url,
          embedUrl: m.embedUrl,
          id: m.id,
          title: m.title,
          author: m.author,
          thumbnail: m.thumbnail,
        },
        format: "media",
      })
      .eq("question_id", data.questionId)
      .eq("creator_wallet", wallet);
    if (error) throw new Error(error.message);
    return { media: m };
  });
