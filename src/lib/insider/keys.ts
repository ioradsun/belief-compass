/**
 * THE INSIDER CACHE KEYS (migration step 6).
 *
 * Surfaces used to name their cache by the component that happened to fetch it
 * ("live-tape"), which is why the same market-scoped question was asked under
 * several names. The Insider owns the intelligence, so it owns the cache scopes
 * too, and there are exactly two:
 *
 *   ["insider", "now",  …]   the GLOBAL feed resource   (InsiderNow)
 *   ["insider", mid, …]      the PER-MARKET resource     (InsiderMarket)
 *
 * Both live under the one `["insider"]` root, so realtime can still invalidate
 * "everything the Insider believes" with a single prefix — which is what the
 * coordinator does on a trade and on reconnect.
 *
 * The keys are FETCH-SHAPED on purpose: two callers that would issue the same
 * request must produce the same key (that is how the YES rail, the NO rail and
 * the Market Insider rail share one fetch), and two callers that would issue
 * different requests must not.
 */

/** The single root every Insider cache scope hangs off. */
export const INSIDER_KEY_ROOT = "insider" as const;

/** Invalidation prefix: every Insider scope, global and per-market. */
export const insiderRootKey = () => [INSIDER_KEY_ROOT] as const;

/**
 * The global feed resource. `side`/`limit` are part of the request, so they are
 * part of the key; `wallet` is the viewer overlay (personal relevance).
 */
export const insiderNowKey = (opts: {
  wallet?: string | null;
  side?: "YES" | "NO" | null;
  limit?: number | null;
  /** A multi-market scope that is not a single market (e.g. your positions). */
  marketIds?: number[] | null;
}) =>
  [
    INSIDER_KEY_ROOT,
    "now",
    opts.wallet ?? null,
    opts.marketIds ?? null,
    opts.side ?? null,
    opts.limit ?? null,
  ] as const;

/**
 * The per-market resource. Deliberately SIDE-BLIND: a side rail is a pure
 * projection of the market's activity (`insider.activity(signals, { side })`),
 * not a different question for the server.
 */
export const insiderMarketKey = (
  marketId: number,
  opts: { wallet?: string | null; limit: number },
) => [INSIDER_KEY_ROOT, marketId, "activity", opts.wallet ?? null, opts.limit] as const;

/** The global feed scope alone — used to invalidate only the app-wide tape. */
export const insiderNowRootKey = () => [INSIDER_KEY_ROOT, "now"] as const;

/**
 * The batched per-market INSIGHT read (the pulse strips under the cards). The
 * spec is the comma-joined id list the request carries, so the key still says
 * exactly which markets the cached answer covers — that is what lets realtime
 * invalidate only the batches holding a market that just traded.
 */
export const insiderPulseKey = (ids: readonly number[] | string) =>
  [INSIDER_KEY_ROOT, "pulse", typeof ids === "string" ? ids : ids.join(",")] as const;

/** Every pulse batch — the reconnect-time re-sync scope. */
export const insiderPulseRootKey = () => [INSIDER_KEY_ROOT, "pulse"] as const;
