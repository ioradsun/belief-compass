-- Downsampled price history for the feed's per-card price block.
--
-- price_snapshots is written on every pov-poller run (~every 2 min), so raw
-- reads over weeks are huge. This buckets to one point per day per market — the
-- resolution a ~60-day sparkline actually needs — and bounds the row count the
-- feed pulls. Runs as caller (RLS applies; price_snapshots is public-readable).
CREATE OR REPLACE FUNCTION public.price_series_daily(p_ids bigint[], p_days int DEFAULT 60)
RETURNS TABLE (onchain_id bigint, bucket date, pct numeric)
LANGUAGE sql
STABLE
AS $$
  SELECT s.onchain_id,
         (date_trunc('day', s.captured_at))::date AS bucket,
         avg(s.money_yes_pct) AS pct
  FROM public.price_snapshots s
  WHERE s.onchain_id = ANY(p_ids)
    AND s.captured_at >= now() - make_interval(days => p_days)
    AND s.money_yes_pct IS NOT NULL
  GROUP BY s.onchain_id, date_trunc('day', s.captured_at)
  ORDER BY s.onchain_id, bucket;
$$;

GRANT EXECUTE ON FUNCTION public.price_series_daily(bigint[], int)
  TO anon, authenticated, service_role;
