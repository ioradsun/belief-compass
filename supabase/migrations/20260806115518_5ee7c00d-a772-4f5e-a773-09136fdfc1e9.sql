CREATE OR REPLACE FUNCTION public.market_window_baselines_bulk(p_ids bigint[], p_window text)
RETURNS TABLE(
  onchain_id bigint,
  captured_at timestamptz,
  believers_yes integer,
  believers_no integer,
  yes_capital_usd numeric,
  no_capital_usd numeric,
  yes_price_usd numeric,
  no_price_usd numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH span AS (
    SELECT CASE p_window
      WHEN '1h'  THEN interval '1 hour'
      WHEN '24h' THEN interval '24 hours'
      WHEN '7d'  THEN interval '7 days'
      WHEN '30d' THEN interval '30 days'
      ELSE NULL
    END AS iv
  )
  SELECT m.id, s.captured_at, s.believers_yes, s.believers_no,
         s.yes_capital_usd, s.no_capital_usd, s.yes_price_usd, s.no_price_usd
  FROM unnest(p_ids) AS m(id)
  CROSS JOIN span
  JOIN LATERAL (
    SELECT ms.captured_at, ms.believers_yes, ms.believers_no,
           ms.yes_capital_usd, ms.no_capital_usd, ms.yes_price_usd, ms.no_price_usd
    FROM public.market_state_snapshots ms
    WHERE ms.onchain_id = m.id
      AND (span.iv IS NULL OR ms.captured_at <= now() - span.iv)
    ORDER BY ms.captured_at DESC
    LIMIT 1
  ) s ON true;
$$;

REVOKE ALL ON FUNCTION public.market_window_baselines_bulk(bigint[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.market_window_baselines_bulk(bigint[], text) TO service_role;