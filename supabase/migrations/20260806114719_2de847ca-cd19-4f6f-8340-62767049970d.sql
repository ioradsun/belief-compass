CREATE OR REPLACE FUNCTION public.recompute_price_changes()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  UPDATE public.market_state ms
  SET chg_1h = CASE
        WHEN l.money_yes_pct IS NOT NULL AND a1.money_yes_pct IS NOT NULL
        THEN l.money_yes_pct - a1.money_yes_pct ELSE NULL END,
      chg_24h = CASE
        WHEN l.money_yes_pct IS NOT NULL AND a24.money_yes_pct IS NOT NULL
        THEN l.money_yes_pct - a24.money_yes_pct ELSE NULL END,
      chg_24h_yes = CASE
        WHEN a24.yes_price_usd IS NOT NULL AND a24.yes_price_usd > 0 AND l.yes_price_usd IS NOT NULL
        THEN ((l.yes_price_usd - a24.yes_price_usd) / a24.yes_price_usd) * 100 ELSE NULL END,
      chg_24h_no = CASE
        WHEN a24.no_price_usd IS NOT NULL AND a24.no_price_usd > 0 AND l.no_price_usd IS NOT NULL
        THEN ((l.no_price_usd - a24.no_price_usd) / a24.no_price_usd) * 100 ELSE NULL END
  FROM public.market_state src
  LEFT JOIN LATERAL (
    SELECT p.money_yes_pct, p.yes_price_usd, p.no_price_usd
    FROM public.price_snapshots p
    WHERE p.onchain_id = src.onchain_id
      AND p.captured_at >= now() - interval '26 hours'
    ORDER BY p.captured_at DESC LIMIT 1
  ) l ON true
  LEFT JOIN LATERAL (
    SELECT p.money_yes_pct
    FROM public.price_snapshots p
    WHERE p.onchain_id = src.onchain_id
      AND p.captured_at <= now() - interval '1 hour'
      AND p.captured_at >= now() - interval '26 hours'
    ORDER BY p.captured_at DESC LIMIT 1
  ) a1 ON true
  LEFT JOIN LATERAL (
    SELECT p.money_yes_pct, p.yes_price_usd, p.no_price_usd
    FROM public.price_snapshots p
    WHERE p.onchain_id = src.onchain_id
      AND p.captured_at <= now() - interval '24 hours'
      AND p.captured_at >= now() - interval '26 hours'
    ORDER BY p.captured_at DESC LIMIT 1
  ) a24 ON true
  WHERE ms.onchain_id = src.onchain_id
    AND l.money_yes_pct IS NOT NULL;
$function$;

REVOKE ALL ON FUNCTION public.recompute_price_changes() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_price_changes() TO service_role;

CREATE OR REPLACE FUNCTION public.market_change_window(p_ids bigint[], p_since timestamp with time zone)
 RETURNS TABLE(onchain_id bigint, chg_yes numeric, chg_no numeric, since_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT
    m.id,
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
  FROM unnest(p_ids) AS m(id)
  JOIN LATERAL (
    SELECT p.captured_at, p.yes_price_usd, p.no_price_usd, p.money_yes_pct
    FROM public.price_snapshots p
    WHERE p.onchain_id = m.id
    ORDER BY p.captured_at DESC LIMIT 1
  ) l ON true
  JOIN LATERAL (
    SELECT p.captured_at, p.yes_price_usd, p.no_price_usd, p.money_yes_pct
    FROM public.price_snapshots p
    WHERE p.onchain_id = m.id
      AND (p_since IS NULL OR p.captured_at >= p_since)
    ORDER BY p.captured_at ASC LIMIT 1
  ) b ON true
  WHERE b.captured_at < l.captured_at;
$function$;

CREATE OR REPLACE FUNCTION public.refresh_market_window_change(p_window text DEFAULT NULL)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  w record;
  v_ids bigint[];
  v_n integer := 0;
  v_step integer;
BEGIN
  SELECT array_agg(onchain_id) INTO v_ids FROM market_state;
  IF v_ids IS NULL THEN RETURN 0; END IF;

  FOR w IN
    SELECT * FROM (VALUES
      ('1h',  interval '1 hour'),
      ('24h', interval '24 hours'),
      ('7d',  interval '7 days'),
      ('30d', interval '30 days'),
      ('all', NULL::interval)
    ) AS t(k, span)
    WHERE p_window IS NULL OR t.k = p_window
  LOOP
    INSERT INTO market_window_change (onchain_id, window_key, chg_yes, chg_no, since_at, updated_at)
    SELECT c.onchain_id, w.k, c.chg_yes, c.chg_no, c.since_at, now()
    FROM market_change_window(
      v_ids,
      CASE WHEN w.span IS NULL THEN NULL ELSE now() - w.span END
    ) c
    ON CONFLICT (onchain_id, window_key) DO UPDATE
      SET chg_yes = EXCLUDED.chg_yes,
          chg_no = EXCLUDED.chg_no,
          since_at = EXCLUDED.since_at,
          updated_at = now();
    GET DIAGNOSTICS v_step = ROW_COUNT;
    v_n := v_n + v_step;
  END LOOP;
  RETURN v_n;
END;
$function$;

DROP FUNCTION IF EXISTS public.refresh_market_window_change();

REVOKE ALL ON FUNCTION public.refresh_market_window_change(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_market_window_change(text) TO service_role;