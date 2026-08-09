CREATE OR REPLACE FUNCTION public.market_price_path(p_ids bigint[], p_hours int DEFAULT 72)
RETURNS TABLE (onchain_id bigint, captured_at timestamptz, yes_price_usd numeric)
LANGUAGE sql
STABLE
AS $$
  SELECT DISTINCT ON (s.onchain_id, date_trunc('hour', s.captured_at))
         s.onchain_id, s.captured_at, s.yes_price_usd
  FROM public.price_snapshots s
  WHERE s.onchain_id = ANY(p_ids)
    AND s.captured_at >= now() - make_interval(hours => p_hours)
    AND s.yes_price_usd IS NOT NULL
  ORDER BY s.onchain_id, date_trunc('hour', s.captured_at), s.captured_at DESC;
$$;

REVOKE ALL ON FUNCTION public.market_price_path(bigint[], int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.market_price_path(bigint[], int) TO service_role;