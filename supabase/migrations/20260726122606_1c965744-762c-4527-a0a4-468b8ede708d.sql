ALTER TABLE public.price_snapshots ADD COLUMN IF NOT EXISTS no_price_usd numeric;
ALTER TABLE public.market_state ADD COLUMN IF NOT EXISTS chg_24h_yes numeric;
ALTER TABLE public.market_state ADD COLUMN IF NOT EXISTS chg_24h_no numeric;

CREATE OR REPLACE FUNCTION public.recompute_price_changes()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH latest AS (
    SELECT DISTINCT ON (onchain_id)
      onchain_id, captured_at, money_yes_pct, yes_price_usd, no_price_usd
    FROM price_snapshots
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
      ps.onchain_id, ps.money_yes_pct AS pct, ps.yes_price_usd, ps.no_price_usd
    FROM price_snapshots ps
    WHERE ps.captured_at <= now() - interval '24 hours'
    ORDER BY ps.onchain_id, ps.captured_at DESC
  )
  UPDATE market_state ms
  SET chg_1h  = (latest.money_yes_pct - h1.pct),
      chg_24h = (latest.money_yes_pct - h24.pct),
      chg_24h_yes = CASE
        WHEN h24.yes_price_usd IS NOT NULL AND h24.yes_price_usd > 0 AND latest.yes_price_usd IS NOT NULL
        THEN ((latest.yes_price_usd - h24.yes_price_usd) / h24.yes_price_usd) * 100
        ELSE NULL END,
      chg_24h_no = CASE
        WHEN h24.no_price_usd IS NOT NULL AND h24.no_price_usd > 0 AND latest.no_price_usd IS NOT NULL
        THEN ((latest.no_price_usd - h24.no_price_usd) / h24.no_price_usd) * 100
        ELSE NULL END
  FROM latest
  LEFT JOIN h1  ON h1.onchain_id  = latest.onchain_id
  LEFT JOIN h24 ON h24.onchain_id = latest.onchain_id
  WHERE ms.onchain_id = latest.onchain_id;
$function$;