CREATE OR REPLACE FUNCTION public.eth_usd_calibration()
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE WHEN SUM(x.eth) > 0 THEN SUM(x.usd) / SUM(x.eth) ELSE NULL END
  FROM (
    SELECT ms.volume_total_usd AS usd, SUM(ev.amount_eth) / 1e18 AS eth
    FROM market_state ms
    JOIN events ev
      ON ev.market_id = ms.onchain_id::text
     AND ev.is_canonical
     AND ev.kind = 'trade'
    WHERE ms.volume_total_usd > 0
    GROUP BY ms.onchain_id, ms.volume_total_usd
  ) x;
$$;

GRANT EXECUTE ON FUNCTION public.eth_usd_calibration() TO anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trades_no_direct_write ON public.trades;
DROP FUNCTION IF EXISTS public.reject_direct_trade_write();
DROP TABLE IF EXISTS public.trades;
DROP TABLE IF EXISTS public.feed_events;