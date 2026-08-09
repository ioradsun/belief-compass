/**
 * THE FACTUAL HALF IS THE SAME QUESTION FOR EVERY READER — so build it once.
 *
 * A signed-in reader used to pay for the entire tape: the three source reads
 * (events, market names + market_state, the eth/usd snapshot) AND the whole
 * viewer-relative composition, even though the source half is defined not to
 * depend on `data.wallet` (see `loadTapeSource`). The anon tape had a shared
 * cache; a wallet meant a full private build.
 *
 * This caches the seam instead of the answer. The key is the viewer-BLIND
 * shape of the question — limit, market scope, side — so anon and every
 * signed-in reader share one source read, and only the relationship/faces work
 * is paid per reader.
 *
 * A `since` delta is never cached: it is a poll for what changed, and serving
 * it from a window-old entry would drop the change it exists to report.
 *
 * Returns plain data (arrays, Maps, numbers) that the composition passes never
 * mutate — the contract `loadTapeSource` already states — which is what makes
 * handing one object to concurrent readers safe.
 */
import { swrCache } from "@/lib/server-cache";
import { loadTapeSource, type TapeQuery, type TapeSource } from "@/lib/insider/source.server";
import type { serviceClient } from "@/lib/supabase-clients";

/** Same window as the shared tape: fresh enough to be live, long enough to share. */
export const SOURCE_TTL_MS = 10_000;

/** Viewer-blind identity of the read. A wallet must never appear here. */
export function sourceCacheKey(data: TapeQuery): string {
  const limit = data?.limit ?? 120;
  const scope = data?.marketIds?.length ? [...data.marketIds].sort((a, b) => a - b).join(",") : "*";
  return `insider:source:${limit}:${scope}:${data?.side ?? "*"}`;
}

export async function loadSharedTapeSource(
  sb: ReturnType<typeof serviceClient>,
  data: TapeQuery,
): Promise<TapeSource> {
  if (data?.since) return loadTapeSource(sb, data);
  return swrCache(sourceCacheKey(data), { ttlMs: SOURCE_TTL_MS }, async () => {
    const source = await loadTapeSource(sb, data);
    // A failed read must not be cached — the next reader has to try again.
    if (source.error) throw new Error(source.error);
    return source;
  }).catch((e) => ({
    ...(await Promise.resolve(loadTapeSource(sb, data))),
    error: e instanceof Error ? e.message : String(e),
  })) as Promise<TapeSource>;
}
