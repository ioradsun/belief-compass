CREATE INDEX IF NOT EXISTS price_snapshots_captured_at_idx
  ON public.price_snapshots (captured_at DESC);

CREATE INDEX IF NOT EXISTS price_snapshots_onchain_captured_cover_idx
  ON public.price_snapshots (onchain_id, captured_at DESC)
  INCLUDE (yes_price_usd, no_price_usd, money_yes_pct);

CREATE OR REPLACE FUNCTION public.recompute_price_changes()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH recent AS MATERIALIZED (
    SELECT onchain_id, captured_at, money_yes_pct, yes_price_usd, no_price_usd
    FROM public.price_snapshots
    WHERE captured_at >= now() - interval '26 hours'
      AND (
        money_yes_pct IS NOT NULL
        OR yes_price_usd IS NOT NULL
        OR no_price_usd IS NOT NULL
      )
  ),
  latest AS (
    SELECT DISTINCT ON (onchain_id)
      onchain_id,
      captured_at,
      money_yes_pct,
      yes_price_usd,
      no_price_usd
    FROM recent
    ORDER BY onchain_id, captured_at DESC
  ),
  h1 AS (
    SELECT DISTINCT ON (onchain_id)
      onchain_id,
      money_yes_pct AS pct
    FROM recent
    WHERE captured_at <= now() - interval '1 hour'
      AND money_yes_pct IS NOT NULL
    ORDER BY onchain_id, captured_at DESC
  ),
  h24 AS (
    SELECT DISTINCT ON (onchain_id)
      onchain_id,
      money_yes_pct AS pct,
      yes_price_usd,
      no_price_usd
    FROM recent
    WHERE captured_at <= now() - interval '24 hours'
    ORDER BY onchain_id, captured_at DESC
  )
  UPDATE public.market_state ms
  SET chg_1h = CASE
        WHEN latest.money_yes_pct IS NOT NULL AND h1.pct IS NOT NULL
        THEN latest.money_yes_pct - h1.pct
        ELSE NULL END,
      chg_24h = CASE
        WHEN latest.money_yes_pct IS NOT NULL AND h24.pct IS NOT NULL
        THEN latest.money_yes_pct - h24.pct
        ELSE NULL END,
      chg_24h_yes = CASE
        WHEN h24.yes_price_usd IS NOT NULL
          AND h24.yes_price_usd > 0
          AND latest.yes_price_usd IS NOT NULL
        THEN ((latest.yes_price_usd - h24.yes_price_usd) / h24.yes_price_usd) * 100
        ELSE NULL END,
      chg_24h_no = CASE
        WHEN h24.no_price_usd IS NOT NULL
          AND h24.no_price_usd > 0
          AND latest.no_price_usd IS NOT NULL
        THEN ((latest.no_price_usd - h24.no_price_usd) / h24.no_price_usd) * 100
        ELSE NULL END
  FROM latest
  LEFT JOIN h1 ON h1.onchain_id = latest.onchain_id
  LEFT JOIN h24 ON h24.onchain_id = latest.onchain_id
  WHERE ms.onchain_id = latest.onchain_id;
$function$;

REVOKE EXECUTE ON FUNCTION public.recompute_price_changes() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_price_changes() TO service_role;