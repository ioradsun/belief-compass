/**
 * THE CANDIDATE POOL — which markets the ranker is allowed to consider at all.
 *
 * THE DEFECT THIS REPLACES, and it was the largest one in the feed. The pool was
 * a single query:
 *
 *     market_state ORDER BY volume_total_usd DESC LIMIT 50
 *
 * Fifty markets out of 2,773 — 1.8% — chosen by LIFETIME VOLUME, which is the
 * least dynamic quantity in the database, and identical for every viewer in
 * every session. Seven scoring components, the DNA overlay, the filters, the
 * modes, the rhythm and the diversity rules all ran on that fixed slate. All
 * personalization could do was reorder the same fifty rows.
 *
 * Measured against production the day this was written:
 *
 *   - 30 markets traded in the last 24h. SEVEN were in the pool.
 *   - 43 of the 50 pool markets had not traded in 24h; the median one had last
 *     traded 39 hours earlier, the stalest 300 hours.
 *   - ZERO pool markets had a new believer in the last hour.
 *   - 78 markets carried a computed opportunity classification. 50 of them were
 *     excluded from the pool that classification exists to feed.
 *
 * And the two components aimed at what the pool structurally cannot contain —
 * `freshness` (0.15) and `early` (0.10) — are a quarter of the weight vector. A
 * market created an hour ago has no volume, so it sat around rank 2,000 and the
 * freshness weight had nothing to apply itself to.
 *
 * WHY SLICES WITH QUOTAS, AND NOT SIMPLY A BIGGER LIMIT. Raising the limit to
 * 300 changes nothing structural: the order is still lifetime volume, so the new
 * market is still at rank 2,000 and `freshness` is still starved. Only a pool
 * assembled from DIFFERENT ORDERINGS can contain the markets the different
 * components are looking for. Each slice is one question the feed needs answered:
 *
 *   ACTIVE      what is alive right now       (last trade, newest first)
 *   FRESH       what is new                   (created, newest first)
 *   CLASSIFIED  what the opportunity engine already flagged
 *   BELIEVED    where people actually are     (directional believers)
 *   DEEP        the substantial book          (lifetime volume — the old pool)
 *
 * Each gets a GUARANTEED quota that the others cannot eat, which is what makes
 * the slices real. Without quotas the largest slice would simply be the pool
 * again under a new name.
 *
 * VIEWER-INDEPENDENT ON PURPOSE. This pool is shared and cached across every
 * reader; personalization happens downstream, over what the pool provides. A
 * viewer-specific pool would be correct and would also mean no cache and one
 * full build per reader. The fix for a starved ranker is to feed it, not to
 * give every reader a private kitchen.
 *
 * ZERO IO, pure, fully testable. The caller runs the queries; this module owns
 * the POLICY — what to ask for, how much of each, and how to merge the answers.
 */

/** The question each slice answers. Provenance travels with the market. */
export type PoolSlice = "active" | "fresh" | "classified" | "believed" | "deep";

/** Every slice, in the order they claim their quota. */
export const POOL_SLICES: PoolSlice[] = ["active", "fresh", "classified", "believed", "deep"];

export interface SliceSpec {
  /** Rows to ask the database for. */
  fetch: number;
  /**
   * Rows this slice keeps even when every other slice is full — its floor in
   * the merged pool. The sum of these is below `TOTAL`, so the remaining space
   * is genuinely contested and a quiet day still fills the pool.
   */
  quota: number;
}

export const POOL: { total: number; slices: Record<PoolSlice, SliceSpec> } = {
  /**
   * The merged pool's ceiling.
   *
   * Chosen against cost, not taste: every id here is carried into the window
   * volume aggregate, the baseline bulk RPC and the viewer's `wallet_beliefs`
   * overlay. Two hundred is roughly 4× the old pool while keeping those three
   * reads comfortably bulk — and it is 25% of the 810 markets that are alive by
   * ANY definition, so the pool stops being the binding constraint on the feed
   * long before it becomes the binding constraint on the query.
   */
  total: 200,
  slices: {
    /**
     * The largest slice, because "what is happening" is the feed's first job
     * and because this is the one ordering the old pool had no way to express.
     */
    active: { fetch: 90, quota: 60 },
    /**
     * Small in absolute terms because the platform creates ~8 markets a day and
     * ~39 in the freshness window — but guaranteed, which it never was. This
     * quota is the entire reason the `freshness` and `early` components can
     * fire at all.
     */
    fresh: { fetch: 40, quota: 25 },
    /**
     * The opportunity engine already ran and already decided. Excluding its
     * output from the pool that consumes it was pure waste.
     */
    classified: { fetch: 50, quota: 30 },
    /** Markets with people in them — the substrate every social signal needs. */
    believed: { fetch: 60, quota: 35 },
    /** The old pool, kept whole: a big book is still a real reason to look. */
    deep: { fetch: 50, quota: 30 },
  },
};

/** One market as it arrives from a slice query, in that slice's own order. */
export interface PoolRow {
  onchainId: number;
}

export interface PoolInput<T extends PoolRow> {
  /** Rows per slice, each already ordered by that slice's own key. */
  bySlice: Partial<Record<PoolSlice, readonly T[]>>;
  /** Override the ceiling — the harness uses this; production does not. */
  total?: number;
}

export interface PooledMarket<T extends PoolRow> {
  row: T;
  /**
   * Every slice that offered this market, in `POOL_SLICES` order.
   *
   * Kept rather than reduced to the first: a market that is simultaneously new,
   * accelerating and classified is a genuinely different thing from one that is
   * only deep, and the diagnostics should be able to say so.
   */
  slices: PoolSlice[];
}

export interface PoolResult<T extends PoolRow> {
  markets: PooledMarket<T>[];
  /** How many made it in per slice — the number to look at when tuning. */
  kept: Record<PoolSlice, number>;
  /** How many DISTINCT markets each slice contributed first. */
  claimed: Record<PoolSlice, number>;
}

const zero = (): Record<PoolSlice, number> =>
  POOL_SLICES.reduce((acc, s) => ((acc[s] = 0), acc), {} as Record<PoolSlice, number>);

/**
 * Merge the slices into one pool.
 *
 * TWO PASSES, and the order matters. First every slice takes its quota in
 * round-robin, so a small slice cannot be crowded out by a large one no matter
 * how the day looks. Then the remaining capacity is filled round-robin from
 * whatever is left, so a quiet slice's unclaimed space goes to a busy one rather
 * than shrinking the pool.
 *
 * Round-robin rather than slice-by-slice on BOTH passes: taking `active` to its
 * full quota before `fresh` starts would put every fresh market at the bottom of
 * the merged list, and callers that truncate would undo the quota. Interleaving
 * means the pool's own order already alternates between the questions.
 */
export function buildPool<T extends PoolRow>(input: PoolInput<T>): PoolResult<T> {
  const total = Math.max(0, input.total ?? POOL.total);
  const cursors = zero();
  const claimed = zero();
  const kept = zero();

  const chosen = new Map<number, PooledMarket<T>>();
  const order: number[] = [];

  /** Take the next unseen market from `slice`, or null when it is exhausted. */
  const take = (slice: PoolSlice): boolean => {
    const rows = input.bySlice[slice] ?? [];
    while (cursors[slice] < rows.length) {
      const row = rows[cursors[slice]]!;
      cursors[slice] += 1;
      const existing = chosen.get(row.onchainId);
      if (existing) {
        // Already in from another slice: record the provenance and keep going.
        // It costs the pool nothing and it does not consume this slice's quota,
        // because the market was going to be there either way.
        if (!existing.slices.includes(slice)) existing.slices.push(slice);
        continue;
      }
      chosen.set(row.onchainId, { row, slices: [slice] });
      order.push(row.onchainId);
      claimed[slice] += 1;
      return true;
    }
    return false;
  };

  // Pass 1 — quotas, round-robin.
  const quotaLeft = { ...zero() };
  for (const s of POOL_SLICES) quotaLeft[s] = POOL.slices[s].quota;
  let progress = true;
  while (progress && chosen.size < total) {
    progress = false;
    for (const s of POOL_SLICES) {
      if (chosen.size >= total) break;
      if (quotaLeft[s] <= 0) continue;
      if (take(s)) {
        quotaLeft[s] -= 1;
        progress = true;
      } else {
        quotaLeft[s] = 0;
      }
    }
  }

  // Pass 2 — fill whatever the quotas left over.
  progress = true;
  while (progress && chosen.size < total) {
    progress = false;
    for (const s of POOL_SLICES) {
      if (chosen.size >= total) break;
      if (take(s)) progress = true;
    }
  }

  const markets = order.map((id) => chosen.get(id)!);
  for (const m of markets) for (const s of m.slices) kept[s] += 1;
  return { markets, kept, claimed };
}

/**
 * Why this market is in the pool at all, for diagnostics.
 *
 * Not reader-facing copy: the reader gets `reasonFor`, which speaks about
 * SIGNALS. This says which door the market came through, which is a question
 * only someone tuning the feed asks.
 */
export function sliceLabel(slice: PoolSlice): string {
  switch (slice) {
    case "active":
      return "recently traded";
    case "fresh":
      return "recently created";
    case "classified":
      return "flagged by the opportunity engine";
    case "believed":
      return "has believers";
    default:
      return "large book";
  }
}
