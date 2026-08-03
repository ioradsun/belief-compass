import { createFileRoute, notFound } from "@tanstack/react-router";
import { useEffect } from "react";
import { getMarketOg } from "@/lib/markets.functions";
import { composeMarketOg } from "@/domain/market-og";
import { marketIdFromParam, marketPath } from "@/domain/share";

// The one canonical origin every share URL, canonical link and sitemap entry
// agree on (matches sitemap.xml and the root head).
const BASE_URL = "https://conviction.company";

/**
 * `/m/<id>-<slug>` — the canonical, shareable address of a single market.
 *
 * This route exists for ONE job the SPA can't do: give a link-preview crawler
 * (iMessage, WhatsApp, Telegram, Discord, Slack, X, Facebook) a real HTML
 * document whose <head> already carries this market's live Open Graph state —
 * the question, the current YES/NO split, and one honest proof point — instead
 * of the app's generic shell.
 *
 * Crawlers don't run JS: they read the SSR head and stop. A human's browser
 * DOES run JS, so the component immediately forwards them to the live app at
 * `/?m=<id>`, where the deck, chart and copy render from the SAME market_state
 * this preview quoted — the preview can never contradict the page it opens.
 */
export const Route = createFileRoute("/m/$mid")({
  loader: async ({ params }) => {
    const id = marketIdFromParam(params.mid);
    if (id == null) throw notFound();

    const data = await getMarketOg({ data: { id } });
    if (!data) throw notFound();

    const og = composeMarketOg({
      question: data.question,
      yesPct: data.yesPct,
      believers: data.believers,
      capitalUsd: data.capitalUsd,
      newBelievers: data.newBelievers,
      // new_believers_24h is a rolling 24h count — a recent change, labelled so.
      newBelieversWindow: "today",
    });

    return {
      id,
      title: og.title,
      description: og.description,
      canonical: `${BASE_URL}${marketPath(id, data.question)}`,
      // Stable per-market image URL (the endpoint resolves media vs. fallback).
      image: `${BASE_URL}/og/market/${id}`,
    };
  },

  head: ({ loaderData }) => {
    // notFound() short-circuits the loader, but head still runs on the error
    // path with no data — fall back to the brand so meta is never broken.
    if (!loaderData) {
      return {
        meta: [{ title: "Conviction — pick a side" }, { name: "twitter:card", content: "summary" }],
      };
    }
    const { title, description, canonical, image } = loaderData;
    return {
      meta: [
        { title: `${title} — Conviction` },
        { name: "description", content: description },
        // The market's live invitation — same text on every platform's card.
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { property: "og:url", content: canonical },
        { property: "og:site_name", content: "Conviction" },
        // A real image on every card: the market's own media, or the branded
        // fallback (resolved by /og/market/<id>). 1200×630 large card.
        { property: "og:image", content: image },
        { property: "og:image:width", content: "1200" },
        { property: "og:image:height", content: "630" },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
        { name: "twitter:image", content: image },
      ],
      links: [{ rel: "canonical", href: canonical }],
    };
  },

  component: MarketShareRedirect,
  // A real 404 for a market id that doesn't exist, so a dead link previews as
  // "not found" rather than a fabricated card.
  notFoundComponent: () => (
    <main className="flex min-h-[100dvh] items-center justify-center bg-[var(--bg)] px-6 text-center">
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-[var(--text)]">
          That market isn&rsquo;t here
        </h1>
        <p className="mt-2 text-[13px] text-[var(--text-muted)]">
          It may have never existed, or the link is wrong.
        </p>
        <a href="/" className="mt-6 inline-block text-[13px] text-[var(--text)] underline">
          Go to Conviction
        </a>
      </div>
    </main>
  ),
});

/**
 * Humans only ever see this for a blink before the app takes over. Crawlers stop
 * at the head above and never reach it. We forward with a full navigation to `/`
 * so the app boots into its normal single-shell state with the market selected.
 */
function MarketShareRedirect() {
  const { id } = Route.useLoaderData();
  useEffect(() => {
    window.location.replace(`/?m=${id}`);
  }, [id]);

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-[var(--bg)] px-6 text-center">
      <p className="text-[13px] text-[var(--text-muted)]">Opening the market…</p>
    </main>
  );
}
