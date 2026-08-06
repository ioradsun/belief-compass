/**
 * THE ONE READ that turns market ids into market names.
 *
 * `markets.title` is the source of truth for what a market is called. This is
 * the only place that reads it for display, so a schema drift breaks one query
 * instead of silently degrading every feed row into "Market #<id>".
 *
 * WHY IT SHOUTS. The Now feed spent weeks printing ids because a sibling column
 * in the same `select` did not exist (`creator_wallet` — the column is
 * `author_wallet`). PostgREST failed the whole request, the caller did
 * `data ?? []`, and every title quietly became a placeholder. Errors here are
 * logged, never swallowed into an empty map without a word.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { marketTitle } from "@/domain/market-title";

// PostgREST sends `in.(...)` in the URL, so ids are chunked to keep it sane.
const CHUNK = 400;

export interface MarketNameRow {
  title: string | null;
  /** The wallet that authored the question — `markets.author_wallet`. */
  authorWallet: string | null;
}

/**
 * Titles (and authors) for the given onchain ids. Missing ids are simply absent
 * from the map; callers render them through `marketTitle()`.
 */
export async function fetchMarketNames(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: SupabaseClient<any, any, any>,
  ids: Array<number | string>,
): Promise<Map<number, MarketNameRow>> {
  const out = new Map<number, MarketNameRow>();
  const unique = [...new Set(ids.map((n) => Number(n)).filter((n) => Number.isFinite(n)))];
  for (let i = 0; i < unique.length; i += CHUNK) {
    const slice = unique.slice(i, i + CHUNK);
    const { data, error } = await sb
      .from("markets")
      .select("onchain_id, title, author_wallet")
      .in("onchain_id", slice);
    if (error) {
      console.error(
        `[market-titles] title lookup FAILED for ${slice.length} ids — every row will ` +
          `render as "Market #<id>": ${error.message}`,
      );
      continue;
    }
    for (const m of (data ?? []) as Array<{
      onchain_id: number | string;
      title: string | null;
      author_wallet: string | null;
    }>) {
      out.set(Number(m.onchain_id), {
        title: typeof m.title === "string" && m.title.trim() ? m.title.trim() : null,
        authorWallet: m.author_wallet ? String(m.author_wallet).toLowerCase() : null,
      });
    }
  }
  return out;
}

/** Titles only, already resolved through the shared fallback. */
export async function fetchMarketTitles(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: SupabaseClient<any, any, any>,
  ids: Array<number | string>,
): Promise<Map<number, string>> {
  const rows = await fetchMarketNames(sb, ids);
  const out = new Map<number, string>();
  for (const [id, r] of rows) out.set(id, marketTitle(r.title, id));
  return out;
}
