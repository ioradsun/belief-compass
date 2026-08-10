CREATE TABLE IF NOT EXISTS public.price_path_hourly (
  onchain_id bigint NOT NULL,
  hour_start timestamptz NOT NULL,
  captured_at timestamptz NOT NULL,
  yes_price_usd numeric NOT NULL,
  PRIMARY KEY (onchain_id, hour_start)
);

GRANT ALL ON public.price_path_hourly TO service_role;
ALTER TABLE public.price_path_hourly ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS price_path_hourly_hour_idx
  ON public.price_path_hourly (hour_start DESC);

CREATE OR REPLACE FUNCTION public.refresh_price_path_hourly(p_hours integer DEFAULT 3)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  n integer;
BEGIN
  WITH ids AS (
    SELECT DISTINCT s.onchain_id
    FROM public.price_snapshots s
    WHERE s.captured_at >= date_trunc('hour', now()) - make_interval(hours => p_hours)
  ),
  hrs AS (
    SELECT generate_series(
      date_trunc('hour', now()) - make_interval(hours => p_hours),
      date_trunc('hour', now()),
      interval '1 hour'
    ) AS h
  ),
  latest AS (
    SELECT p.onchain_id, hrs.h AS hour_start, p.captured_at, p.yes_price_usd
    FROM ids
    CROSS JOIN hrs
    CROSS JOIN LATERAL (
      SELECT s.onchain_id, s.captured_at, s.yes_price_usd
      FROM public.price_snapshots s
      WHERE s.onchain_id = ids.onchain_id
        AND s.captured_at >= hrs.h
        AND s.captured_at < hrs.h + interval '1 hour'
        AND s.yes_price_usd IS NOT NULL
      ORDER BY s.captured_at DESC
      LIMIT 1
    ) p
  )
  INSERT INTO public.price_path_hourly (onchain_id, hour_start, captured_at, yes_price_usd)
  SELECT onchain_id, hour_start, captured_at, yes_price_usd FROM latest
  ON CONFLICT (onchain_id, hour_start) DO UPDATE
    SET captured_at = EXCLUDED.captured_at,
        yes_price_usd = EXCLUDED.yes_price_usd;
  GET DIAGNOSTICS n = ROW_COUNT;

  DELETE FROM public.price_path_hourly
  WHERE hour_start < now() - interval '10 days';

  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_price_path_hourly(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_price_path_hourly(integer) TO service_role;

-- Backfill the window the feed reads.
SELECT public.refresh_price_path_hourly(72);

CREATE OR REPLACE FUNCTION public.market_price_path(p_ids bigint[], p_hours integer DEFAULT 72)
RETURNS TABLE(onchain_id bigint, captured_at timestamp with time zone, yes_price_usd numeric)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT h.onchain_id, h.captured_at, h.yes_price_usd
  FROM public.price_path_hourly h
  WHERE h.onchain_id = ANY(p_ids)
    AND h.hour_start >= date_trunc('hour', now()) - make_interval(hours => p_hours)
  ORDER BY h.onchain_id, h.hour_start;
$function$;

REVOKE ALL ON FUNCTION public.market_price_path(bigint[], integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.market_price_path(bigint[], integer) TO service_role;
