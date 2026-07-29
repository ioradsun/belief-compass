CREATE OR REPLACE FUNCTION public.detect_tribe_doublings()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emitted int := 0;
BEGIN
  WITH cand AS (
    SELECT
      ms.onchain_id::text AS market_id,
      s.side,
      (CASE WHEN s.side = 'YES' THEN ms.believers_yes ELSE ms.believers_no END) AS cnt,
      (CASE WHEN s.side = 'YES' THEN ms.new_believers_yes_24h ELSE ms.new_believers_no_24h END)
        AS gained
    FROM public.market_state ms
    CROSS JOIN (VALUES ('YES'), ('NO')) AS s(side)
  ),
  doubled AS (
    SELECT market_id, side, cnt, gained
    FROM cand
    WHERE gained > 0
      AND (cnt - gained) >= 5
      AND cnt >= 2 * (cnt - gained)
  ),
  ins AS (
    INSERT INTO public.events (source_key, source, kind, market_id, side, occurred_at, payload)
    SELECT
      'tribe_doubled:' || market_id || ':' || side || ':' || to_char(now(), 'YYYY-MM-DD'),
      'system',
      'tribe_doubled',
      market_id,
      side,
      now(),
      jsonb_build_object('count', cnt, 'gained', gained)
    FROM doubled
    ON CONFLICT (source_key) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_emitted FROM ins;

  RETURN v_emitted;
END;
$$;

REVOKE ALL ON FUNCTION public.detect_tribe_doublings() FROM public;
GRANT EXECUTE ON FUNCTION public.detect_tribe_doublings() TO service_role;