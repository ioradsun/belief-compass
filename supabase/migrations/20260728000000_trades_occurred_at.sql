-- Phase 1 — make event time canonical.
--
-- A chain trade's event time must be the timestamp of the Base block that
-- contains its log, never the time the poller ran. The old `trades.ts` column
-- was assigned new Date() at ingestion, so during backfill historical activity
-- looked like it happened now. Split the two concepts:
--
--   occurred_at  — the canonical Base block time (user-facing recency/order)
--   ingested_at  — when Conviction stored the row (operational only)
--
-- The existing `ts` values ARE ingestion time, so they move to ingested_at.
-- occurred_at is left NULL for historical rows and backfilled from block times
-- by scripts/backfill-block-times.ts. Until that completes, rows with
-- occurred_at IS NULL are excluded from recency (they are not "recent").

ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS occurred_at timestamptz;
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS ingested_at timestamptz;

-- Preserve the old ingestion timestamps.
UPDATE public.trades SET ingested_at = ts WHERE ingested_at IS NULL;

ALTER TABLE public.trades ALTER COLUMN ingested_at SET DEFAULT now();
ALTER TABLE public.trades ALTER COLUMN ingested_at SET NOT NULL;

-- `ts` is retired as an event-time source. Keep the column for now (a later,
-- documented migration may drop it) but stop requiring it so new inserts that
-- only write occurred_at + ingested_at succeed. occurred_at stays NULLABLE until
-- the historical backfill has verifiably filled every row (see finalize SQL).
ALTER TABLE public.trades ALTER COLUMN ts DROP NOT NULL;

-- Recency index by canonical event time.
CREATE INDEX IF NOT EXISTS trades_market_occurred_idx
  ON public.trades (onchain_id, occurred_at DESC);
-- Cheap lookup of the rows still awaiting a block time, for the backfill.
CREATE INDEX IF NOT EXISTS trades_occurred_null_idx
  ON public.trades (block_number)
  WHERE occurred_at IS NULL;

-- Windowed volume must count by EVENT time and skip rows without one, so a
-- freshly-imported historical trade never inflates a recent window.
CREATE OR REPLACE FUNCTION public.market_volume_window(p_ids bigint[], p_since timestamptz)
RETURNS TABLE(onchain_id bigint, side text, eth numeric, trade_count bigint)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT t.onchain_id, t.side, SUM(t.eth_amount)/1e18 AS eth, COUNT(*)::bigint AS trade_count
  FROM trades t
  WHERE t.onchain_id = ANY(p_ids)
    AND t.occurred_at IS NOT NULL
    AND (p_since IS NULL OR t.occurred_at >= p_since)
  GROUP BY t.onchain_id, t.side;
$$;

GRANT EXECUTE ON FUNCTION public.market_volume_window(bigint[], timestamptz)
  TO anon, authenticated, service_role;
