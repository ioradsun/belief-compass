
REVOKE EXECUTE ON FUNCTION public.recompute_price_changes() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_price_changes() TO service_role;

CREATE OR REPLACE FUNCTION public.price_series_daily(p_ids bigint[], p_days int)
RETURNS TABLE (onchain_id bigint, bucket date, pct numeric)
LANGUAGE sql
STABLE
SECURITY INVOKER
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
