/**
 * Canonical event time — pure helpers shared by the chain poller, the historical
 * backfill and their tests.
 *
 * First principle: a chain trade's event time is the timestamp of the Base block
 * that contains its log. It is NEVER the time the poller happened to run. These
 * helpers make that assignment (a) deduplicated — one block fetch per unique
 * block even when many logs share it — and (b) honest about recency: a row whose
 * block time is unknown (occurred_at IS NULL) is never "recent".
 *
 * ZERO IO. Block fetching is injected as a function so it can be counted/mocked.
 */

export interface HasBlock {
  block_number: number | bigint;
}

export interface CanonicalKey {
  tx_hash: string;
  log_index: number;
}

/** Distinct block numbers represented by a batch of logs/trades. */
export function uniqueBlockNumbers(rows: HasBlock[]): number[] {
  const s = new Set<number>();
  for (const r of rows) s.add(Number(r.block_number));
  return [...s];
}

/**
 * Fetch each block's timestamp exactly once, with bounded concurrency so a busy
 * range can't create an unbounded RPC burst. `getTs(block)` returns the block's
 * UNIX time in SECONDS (viem's `getBlock().timestamp`). Returns block → ISO time.
 */
export async function fetchBlockTimes(
  blockNumbers: (number | bigint)[],
  getTs: (block: number) => Promise<number>,
  concurrency = 5,
): Promise<Map<number, string>> {
  const unique = [...new Set(blockNumbers.map((b) => Number(b)))];
  const out = new Map<number, string>();
  let next = 0;
  const worker = async () => {
    while (next < unique.length) {
      const b = unique[next++];
      const secs = await getTs(b);
      out.set(b, new Date(secs * 1000).toISOString());
    }
  };
  const lanes = Math.max(1, Math.min(concurrency, unique.length));
  await Promise.all(Array.from({ length: lanes }, worker));
  return out;
}

/** The block's event time, or null when we don't know it yet (→ backfill). */
export function occurredAtFor(
  block: number | bigint,
  blockTimes: Map<number, string>,
): string | null {
  return blockTimes.get(Number(block)) ?? null;
}

/**
 * Is this event within `windowMs` of `nowMs`, by its EVENT time? An unknown
 * (null) occurred_at is never recent — a row imported today but with no block
 * time must not count toward last-5m / last-hour / recently-touched windows.
 * `ingested_at` is deliberately not accepted here: ingestion time is not event
 * time and must never stand in for recency.
 */
export function isRecentByEventTime(
  occurredAtIso: string | null | undefined,
  nowMs: number,
  windowMs: number,
): boolean {
  if (!occurredAtIso) return false;
  const t = new Date(occurredAtIso).getTime();
  if (!Number.isFinite(t)) return false;
  return t <= nowMs && nowMs - t <= windowMs;
}

/** Canonical chain order: block_number ASC, then log_index ASC. */
export function canonicalCompare(a: HasBlock & CanonicalKey, b: HasBlock & CanonicalKey): number {
  const bn = Number(a.block_number) - Number(b.block_number);
  return bn !== 0 ? bn : a.log_index - b.log_index;
}

/** Recency order for feeds: occurred_at DESC, block_number DESC, log_index DESC.
 *  Rows with a null occurred_at sort last (they are not recent). */
export function recencyCompare(
  a: { occurred_at: string | null } & HasBlock & CanonicalKey,
  b: { occurred_at: string | null } & HasBlock & CanonicalKey,
): number {
  const at = a.occurred_at ? new Date(a.occurred_at).getTime() : -Infinity;
  const bt = b.occurred_at ? new Date(b.occurred_at).getTime() : -Infinity;
  if (at !== bt) return bt - at;
  const bn = Number(b.block_number) - Number(a.block_number);
  if (bn !== 0) return bn;
  return b.log_index - a.log_index;
}

/**
 * Build the trade row to upsert. `occurred_at` is the deterministic block time
 * (same on every replay). `ingested_at` is DELIBERATELY OMITTED: on insert the
 * column defaults to now(); on a conflicting replay of an unchanged row it is
 * left untouched, so re-scanning the reorg overlap never looks like fresh
 * ingestion. The canonical identity stays tx_hash + log_index.
 */
export function tradeRowWithOccurredAt<T extends HasBlock>(
  canonical: T,
  blockTimes: Map<number, string>,
): T & { occurred_at: string | null } {
  return { ...canonical, occurred_at: occurredAtFor(canonical.block_number, blockTimes) };
}
