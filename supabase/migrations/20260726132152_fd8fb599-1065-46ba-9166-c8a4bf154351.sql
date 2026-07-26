CREATE OR REPLACE FUNCTION public.market_change_window(p_ids bigint[], p_since timestamptz)
RETURNS TABLE(onchain_id bigint, chg_yes numeric, chg_no numeric, since_at timestamptz)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  WITH latest AS (
    SELECT DISTINCT ON (ps.onchain_id)
      ps.onchain_id, ps.captured_at, ps.yes_price_usd, ps.no_price_usd, ps.money_yes_pct
    FROM price_snapshots ps
    WHERE ps.onchain_id = ANY(p_ids)
    ORDER BY ps.onchain_id, ps.captured_at DESC
  ),
  base AS (
    SELECT DISTINCT ON (ps.onchain_id)
      ps.onchain_id, ps.captured_at, ps.yes_price_usd, ps.no_price_usd, ps.money_yes_pct
    FROM price_snapshots ps
    WHERE ps.onchain_id = ANY(p_ids)
      AND (p_since IS NULL OR ps.captured_at >= p_since)
    ORDER BY ps.onchain_id, ps.captured_at ASC
  )
  SELECT
    l.onchain_id,
    CASE WHEN b.yes_price_usd > 0 AND l.yes_price_usd IS NOT NULL
         THEN ((l.yes_price_usd - b.yes_price_usd) / b.yes_price_usd) * 100 END,
    CASE WHEN b.no_price_usd > 0 AND l.no_price_usd IS NOT NULL
         THEN ((l.no_price_usd - b.no_price_usd) / b.no_price_usd) * 100
         WHEN b.yes_price_usd > 0 AND b.money_yes_pct > 0 AND b.money_yes_pct < 100
              AND l.yes_price_usd IS NOT NULL AND l.money_yes_pct > 0 AND l.money_yes_pct < 100
         THEN (
            ((l.yes_price_usd / l.money_yes_pct) * (100 - l.money_yes_pct)
             - (b.yes_price_usd / b.money_yes_pct) * (100 - b.money_yes_pct))
            / ((b.yes_price_usd / b.money_yes_pct) * (100 - b.money_yes_pct))
         ) * 100 END,
    b.captured_at
  FROM latest l
  JOIN base b ON b.onchain_id = l.onchain_id
  WHERE b.captured_at < l.captured_at;
$$;

GRANT EXECUTE ON FUNCTION public.market_change_window(bigint[], timestamptz) TO anon, authenticated, service_role;