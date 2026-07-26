
-- Compute chg_1h and chg_24h from price_snapshots into market_state.
CREATE OR REPLACE FUNCTION public.recompute_price_changes()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH latest AS (
    SELECT DISTINCT ON (onchain_id)
      onchain_id, captured_at, money_yes_pct
    FROM price_snapshots
    WHERE money_yes_pct IS NOT NULL
    ORDER BY onchain_id, captured_at DESC
  ),
  h1 AS (
    SELECT DISTINCT ON (ps.onchain_id)
      ps.onchain_id, ps.money_yes_pct AS pct
    FROM price_snapshots ps
    WHERE ps.captured_at <= now() - interval '1 hour'
      AND ps.money_yes_pct IS NOT NULL
    ORDER BY ps.onchain_id, ps.captured_at DESC
  ),
  h24 AS (
    SELECT DISTINCT ON (ps.onchain_id)
      ps.onchain_id, ps.money_yes_pct AS pct
    FROM price_snapshots ps
    WHERE ps.captured_at <= now() - interval '24 hours'
      AND ps.money_yes_pct IS NOT NULL
    ORDER BY ps.onchain_id, ps.captured_at DESC
  )
  UPDATE market_state ms
  SET chg_1h  = (latest.money_yes_pct - h1.pct),
      chg_24h = (latest.money_yes_pct - h24.pct)
  FROM latest
  LEFT JOIN h1  ON h1.onchain_id  = latest.onchain_id
  LEFT JOIN h24 ON h24.onchain_id = latest.onchain_id
  WHERE ms.onchain_id = latest.onchain_id;
$$;

GRANT EXECUTE ON FUNCTION public.recompute_price_changes() TO anon, authenticated, service_role;

-- Daily buckets of implied YES % for the last p_days days.
CREATE OR REPLACE FUNCTION public.price_series_daily(p_ids bigint[], p_days int)
RETURNS TABLE (onchain_id bigint, bucket date, pct numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    ps.onchain_id,
    (date_trunc('day', ps.captured_at))::date AS bucket,
    AVG(ps.money_yes_pct)::numeric AS pct
  FROM price_snapshots ps
  WHERE ps.onchain_id = ANY(p_ids)
    AND ps.captured_at >= now() - (p_days || ' days')::interval
    AND ps.money_yes_pct IS NOT NULL
  GROUP BY ps.onchain_id, bucket
  ORDER BY ps.onchain_id, bucket;
$$;

GRANT EXECUTE ON FUNCTION public.price_series_daily(bigint[], int) TO anon, authenticated, service_role;

-- Run it once so the feed has data immediately.
SELECT public.recompute_price_changes();
