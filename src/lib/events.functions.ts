/**
 * Canonical event reads — the ONE place product code queries `events`.
 *
 * Every function here:
 *   • filters is_canonical = true   (orphaned reorg events are never shown)
 *   • orders by occurred_at (canonical event time) with deterministic tie-breaks
 *   • is bounded (no unbounded scans, no unbounded payloads — raw payload is NOT
 *     selected, so raw_log never ships to a client)
 *   • normalizes wallet + market_id consistently
 *
 * It returns FACTS (EventFact) only — no ranking, personalization, opportunity
 * scoring or feed copy. Presentation layers adapt these facts; the seam back to
 * the current feed UI is `toLegacyFeedEventRow` in the pure module.
 *
 * No component should build a raw `events` query when a function here fits.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { publicClient } from "@/lib/supabase-clients";
import { type EventFact } from "@/lib/events";

// Columns safe + sufficient for activity reads. Deliberately excludes `payload`
// (raw_log) and operational timestamps (ingested_at/created_at).
const SELECT =
  "source_key, source, kind, market_id, wallet, side, action, amount_eth, shares, price, chain_id, block_number, log_index, occurred_at";

const MAX_LIMIT = 1000;

type Row = {
  source_key: string;
  source: string;
  kind: string;
  market_id: string | null;
  wallet: string | null;
  side: string | null;
  action: string | null;
  amount_eth: number | string | null;
  shares: number | string | null;
  price: number | string | null;
  chain_id: number | null;
  block_number: number | null;
  log_index: number | null;
  occurred_at: string;
};

function toFact(r: Row): EventFact {
  return {
    source_key: r.source_key,
    source: r.source,
    kind: r.kind,
    market_id: r.market_id != null ? String(r.market_id) : null,
    wallet: r.wallet != null ? r.wallet.toLowerCase() : null,
    side: r.side,
    action: r.action,
    // numeric columns come back as strings from PostgREST; keep them as strings
    // so wei precision is never truncated through a JS number.
    amount_eth: r.amount_eth != null ? String(r.amount_eth) : null,
    shares: r.shares != null ? String(r.shares) : null,
    price: r.price != null ? String(r.price) : null,
    chain_id: r.chain_id,
    block_number: r.block_number,
    log_index: r.log_index,
    occurred_at: r.occurred_at,
    payload: null,
  };
}

// Deterministic reverse-chronological order at the DB: occurred_at DESC, then
// block_number DESC, log_index DESC, and source_key as the final stable key
// (proxy for `id` — same-timestamp non-chain events never reorder).
function orderRecency<T>(q: T): T {
  const b = q as unknown as {
    order: (c: string, o: { ascending: boolean; nullsFirst?: boolean }) => unknown;
  };
  b.order("occurred_at", { ascending: false });
  b.order("block_number", { ascending: false, nullsFirst: false });
  b.order("log_index", { ascending: false, nullsFirst: false });
  b.order("source_key", { ascending: false });
  return q;
}

const baseInput = z.object({
  limit: z.number().int().min(1).max(MAX_LIMIT).optional(),
  kinds: z.array(z.string()).max(8).optional(),
  sinceOccurredAt: z.string().optional(),
});

/** Global recent canonical activity. Defaults to trade events (the feed spine). */
export const listLatestEvents = createServerFn({ method: "GET" })
  .inputValidator((d: z.input<typeof baseInput> | undefined) => baseInput.parse(d ?? {}))
  .handler(async ({ data }) => {
    const sb = publicClient();
    const kinds = data.kinds ?? ["trade"];
    let q = sb.from("events").select(SELECT).eq("is_canonical", true).in("kind", kinds);
    if (data.sinceOccurredAt) q = q.gte("occurred_at", data.sinceOccurredAt);
    q = orderRecency(q).limit(data.limit ?? 500) as typeof q;
    const { data: rows, error } = await q;
    if (error) return { data: [] as EventFact[], error: error.message };
    return { data: (rows ?? []).map((r) => toFact(r as Row)), error: null };
  });

const marketInput = baseInput.extend({ marketId: z.union([z.number().int(), z.string()]) });

/** Recent canonical activity for one market. */
export const listMarketEvents = createServerFn({ method: "GET" })
  .inputValidator((d: z.input<typeof marketInput>) => marketInput.parse(d))
  .handler(async ({ data }) => {
    const sb = publicClient();
    const kinds = data.kinds ?? ["trade"];
    let q = sb
      .from("events")
      .select(SELECT)
      .eq("is_canonical", true)
      .eq("market_id", String(data.marketId))
      .in("kind", kinds);
    if (data.sinceOccurredAt) q = q.gte("occurred_at", data.sinceOccurredAt);
    q = orderRecency(q).limit(data.limit ?? 50) as typeof q;
    const { data: rows, error } = await q;
    if (error) return { data: [] as EventFact[], error: error.message };
    return { data: (rows ?? []).map((r) => toFact(r as Row)), error: null };
  });

const walletInput = baseInput.extend({ wallet: z.string().min(3) });

/** Recent canonical activity for one wallet. */
export const listWalletEvents = createServerFn({ method: "GET" })
  .inputValidator((d: z.input<typeof walletInput>) => walletInput.parse(d))
  .handler(async ({ data }) => {
    const sb = publicClient();
    const kinds = data.kinds ?? ["trade"];
    let q = sb
      .from("events")
      .select(SELECT)
      .eq("is_canonical", true)
      .eq("wallet", data.wallet.toLowerCase())
      .in("kind", kinds);
    if (data.sinceOccurredAt) q = q.gte("occurred_at", data.sinceOccurredAt);
    q = orderRecency(q).limit(data.limit ?? 100) as typeof q;
    const { data: rows, error } = await q;
    if (error) return { data: [] as EventFact[], error: error.message };
    return { data: (rows ?? []).map((r) => toFact(r as Row)), error: null };
  });

/**
 * Plain (non-serverFn) canonical trade reader for server-to-server callers that
 * already hold a supabase client and want the legacy feed_events row shape via
 * `toLegacyFeedEventRow`. Filters is_canonical, bounded, ordered by event time.
 */
export async function readLatestTradeEvents(
  sb: ReturnType<typeof publicClient>,
  opts: { marketIds?: number[]; limit?: number } = {},
): Promise<EventFact[]> {
  let q = sb.from("events").select(SELECT).eq("is_canonical", true).eq("kind", "trade");
  if (opts.marketIds && opts.marketIds.length > 0) {
    q = q.in(
      "market_id",
      opts.marketIds.map((n) => String(n)),
    );
  }
  q = orderRecency(q).limit(Math.min(opts.limit ?? 500, MAX_LIMIT)) as typeof q;
  const { data: rows, error } = await q;
  if (error) return [];
  return (rows ?? []).map((r) => toFact(r as Row));
}
