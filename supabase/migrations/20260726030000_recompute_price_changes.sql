-- The pov-poller has always called recompute_price_changes(), but the function
-- was never defined — so the call silently no-op'd and market_state.chg_1h /
-- chg_24h stayed NULL. That starved the feed: no 24h performance on cards and no
-- scoreboard format (which needs a real % move). This defines it.
--
-- Computes each market's 1h / 24h price performance as the % change in the YES
-- share price, from price_snapshots (nearest snapshot at/older than the cutoff
-- vs the latest). Markets without enough history keep their existing value.
CREATE OR REPLACE FUNCTION public.recompute_price_changes()
RETURNS TABLE (updated integer)
LANGUAGE plpgsql
AS $$
DECLARE
  n integer;
BEGIN
  WITH latest AS (
    SELECT DISTINCT ON (onchain_id) onchain_id, yes_price_usd AS now_price
    FROM public.price_snapshots
    WHERE yes_price_usd IS NOT NULL
    ORDER BY onchain_id, captured_at DESC
  ),
  ago1 AS (
    SELECT DISTINCT ON (onchain_id) onchain_id, yes_price_usd AS p
    FROM public.price_snapshots
    WHERE yes_price_usd IS NOT NULL AND captured_at <= now() - interval '1 hour'
    ORDER BY onchain_id, captured_at DESC
  ),
  ago24 AS (
    SELECT DISTINCT ON (onchain_id) onchain_id, yes_price_usd AS p
    FROM public.price_snapshots
    WHERE yes_price_usd IS NOT NULL AND captured_at <= now() - interval '24 hours'
    ORDER BY onchain_id, captured_at DESC
  )
  UPDATE public.market_state ms
  SET chg_1h = CASE
        WHEN a1.p IS NOT NULL AND a1.p > 0
        THEN round(((l.now_price - a1.p) / a1.p * 100)::numeric, 2)
        ELSE ms.chg_1h END,
      chg_24h = CASE
        WHEN a24.p IS NOT NULL AND a24.p > 0
        THEN round(((l.now_price - a24.p) / a24.p * 100)::numeric, 2)
        ELSE ms.chg_24h END
  FROM latest l
  LEFT JOIN ago1  a1  ON a1.onchain_id  = l.onchain_id
  LEFT JOIN ago24 a24 ON a24.onchain_id = l.onchain_id
  WHERE ms.onchain_id = l.onchain_id;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN QUERY SELECT n;
END;
$$;

-- The pov-poller runs as service_role; allow authenticated too for manual runs.
GRANT EXECUTE ON FUNCTION public.recompute_price_changes() TO service_role, authenticated;
