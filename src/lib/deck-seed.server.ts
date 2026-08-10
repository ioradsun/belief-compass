/**
 * THE DECK SEED — the centre panel's first numbers, where a COLD isolate can reach them.
 *
 * The Insider tape solved this already: SSR peeks at a warm in-process snapshot,
 * and on a cold isolate reads a single stored row instead of paying for the
 * build. The centre panel had only half of it — the seeded FEED gave the shell a
 * real market title, but its deck core (the trade tape every number on the card
 * is rebuilt from) was still a client round trip after hydration, so the market
 * appeared and then filled in.
 *
 * So the warmer stores the deck core for the first few feed markets in the same
 * `feed_snapshot` table, keyed by COPY_VERSION for the same reason: a deploy
 * must never be able to paint the previous build's numbers.
 *
 * PAINT ONLY. The client still fetches; this just means the first frame has the
 * numbers in it.
 */
import { COPY_VERSION } from "@/domain/copy-version";
import { serviceClientOrNull } from "@/lib/supabase-clients";
import { peekSwr } from "@/lib/server-cache";
import { marketCoreKey } from "@/lib/market-core-cache.server";
import type { MarketChange } from "@/lib/markets.functions";

export type DeckSeed = Record<string, MarketChange>;

const SEED_KEY = `deck:core:${COPY_VERSION}`;
/** The markets a first visitor can reach without a fetch: the seeded cards. */
export const DECK_SEED_MARKETS = 3;
/** A seed that cannot be read quickly is not a seed. Bound the SSR read. */
const SEED_READ_MS = 700;

export async function writeDeckSeed(entries: DeckSeed): Promise<void> {
  try {
    if (!Object.keys(entries).length) return;
    const sb = serviceClientOrNull();
    if (!sb) return;
    await sb.from("feed_snapshot").upsert(
      {
        key: SEED_KEY,
        payload: entries as unknown as never,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );
  } catch {
    // A cache that fails to write must never fail the deck.
  }
}

async function readDeckSeed(): Promise<DeckSeed | null> {
  try {
    const sb = serviceClientOrNull();
    if (!sb) return null;
    const read = sb.from("feed_snapshot").select("payload").eq("key", SEED_KEY).maybeSingle();
    const res = await Promise.race([
      read,
      new Promise<null>((r) => setTimeout(() => r(null), SEED_READ_MS)),
    ]);
    const payload = (res as { data?: { payload?: unknown } } | null)?.data?.payload;
    if (!payload || typeof payload !== "object") return null;
    return payload as DeckSeed;
  } catch {
    return null;
  }
}

/**
 * The SSR read: this isolate's warm per-market entries, else the stored seed.
 * NEVER builds — the shell must not wait on a trade replay.
 */
export async function warmDeckCore(ids: readonly number[]): Promise<DeckSeed | null> {
  const warm: DeckSeed = {};
  for (const id of ids.slice(0, DECK_SEED_MARKETS)) {
    const hit = peekSwr<MarketChange>(marketCoreKey("change", id));
    if (hit) warm[String(id)] = hit;
  }
  if (Object.keys(warm).length) return warm;
  return readDeckSeed();
}
