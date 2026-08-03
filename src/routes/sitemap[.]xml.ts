import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { marketPath } from "@/domain/share";

const BASE_URL = "https://conviction.company";

/** Every publicly shareable market, as its canonical `/m/<id>-<slug>` URL. */
async function marketEntries(): Promise<{ path: string }[]> {
  try {
    const { publicClient } = await import("@/lib/supabase-clients");
    const sb = publicClient();
    // Only markets with live state get a canonical page (the /m route reads
    // market_state); title comes from the same metadata source the page uses.
    const { data } = await sb
      .from("market_state")
      .select("onchain_id, markets:onchain_id ( title )")
      .order("last_trade_at", { ascending: false, nullsFirst: false })
      .limit(2000);
    const rows = (data ?? []) as unknown as {
      onchain_id: number;
      // PostgREST types a to-one embed as an array; accept either shape.
      markets?: { title?: string | null } | { title?: string | null }[] | null;
    }[];
    return rows
      .filter((r) => Number.isFinite(Number(r.onchain_id)))
      .map((r) => {
        const mk = Array.isArray(r.markets) ? r.markets[0] : r.markets;
        return { path: marketPath(Number(r.onchain_id), mk?.title ?? null) };
      });
  } catch {
    // A sitemap is best-effort: never fail the whole document over market rows.
    return [];
  }
}

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const staticEntries = [
          { path: "/", changefreq: "hourly", priority: "1.0" },
          { path: "/terms", changefreq: "monthly", priority: "0.4" },
        ];
        const markets = (await marketEntries()).map((m) => ({
          path: m.path,
          changefreq: "hourly",
          priority: "0.7",
        }));
        const urls = [...staticEntries, ...markets].map((e) =>
          [
            `  <url>`,
            `    <loc>${BASE_URL}${e.path}</loc>`,
            `    <changefreq>${e.changefreq}</changefreq>`,
            `    <priority>${e.priority}</priority>`,
            `  </url>`,
          ].join("\n"),
        );
        const xml = [
          `<?xml version="1.0" encoding="UTF-8"?>`,
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
          ...urls,
          `</urlset>`,
        ].join("\n");
        return new Response(xml, {
          headers: { "Content-Type": "application/xml", "Cache-Control": "public, max-age=3600" },
        });
      },
    },
  },
});
