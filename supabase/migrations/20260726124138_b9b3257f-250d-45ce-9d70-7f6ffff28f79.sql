CREATE OR REPLACE FUNCTION public.market_volume_window(p_ids bigint[], p_since timestamptz)
RETURNS TABLE(onchain_id bigint, side text, eth numeric, trade_count bigint)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT t.onchain_id, t.side, SUM(t.eth_amount)/1e18 AS eth, COUNT(*)::bigint AS trade_count
  FROM trades t
  WHERE t.onchain_id = ANY(p_ids)
    AND (p_since IS NULL OR t.ts >= p_since)
  GROUP BY t.onchain_id, t.side;
$$;

GRANT EXECUTE ON FUNCTION public.market_volume_window(bigint[], timestamptz) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.eth_usd_calibration()
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE WHEN SUM(x.eth) > 0 THEN SUM(x.usd) / SUM(x.eth) ELSE NULL END
  FROM (
    SELECT ms.volume_total_usd AS usd, SUM(t.eth_amount)/1e18 AS eth
    FROM market_state ms
    JOIN trades t ON t.onchain_id = ms.onchain_id
    WHERE ms.volume_total_usd > 0
    GROUP BY ms.onchain_id, ms.volume_total_usd
  ) x;
$$;

GRANT EXECUTE ON FUNCTION public.eth_usd_calibration() TO anon, authenticated, service_role;