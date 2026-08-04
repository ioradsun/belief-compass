CREATE TABLE IF NOT EXISTS public.market_state_snapshots (
  onchain_id      bigint      NOT NULL,
  captured_at     timestamptz NOT NULL DEFAULT now(),
  believers_yes   integer,
  believers_no    integer,
  yes_capital_usd numeric,
  no_capital_usd  numeric,
  yes_price_usd   numeric,
  no_price_usd    numeric
);

GRANT SELECT ON public.market_state_snapshots TO anon, authenticated;
GRANT ALL ON public.market_state_snapshots TO service_role;

CREATE INDEX IF NOT EXISTS market_state_snapshots_id_time
  ON public.market_state_snapshots (onchain_id, captured_at DESC);

ALTER TABLE public.market_state_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS market_state_snapshots_read ON public.market_state_snapshots;
CREATE POLICY market_state_snapshots_read
  ON public.market_state_snapshots FOR SELECT USING (true);

CREATE OR REPLACE FUNCTION public.snapshot_market_state()
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE n integer;
BEGIN
  INSERT INTO public.market_state_snapshots
    (onchain_id, believers_yes, believers_no,
     yes_capital_usd, no_capital_usd, yes_price_usd, no_price_usd)
  SELECT onchain_id, believers_yes, believers_no,
         yes_capital_usd, no_capital_usd, yes_price_usd, no_price_usd
  FROM public.market_state;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.snapshot_market_state() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.snapshot_market_state() TO service_role;

CREATE OR REPLACE FUNCTION public.market_window_baselines(p_id bigint)
RETURNS TABLE (
  window_key      text,
  believers_yes   integer,
  believers_no    integer,
  yes_capital_usd numeric,
  no_capital_usd  numeric,
  yes_price_usd   numeric,
  no_price_usd    numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH windows(window_key, cutoff) AS (
    VALUES
      ('1h',  now() - interval '1 hour'),
      ('24h', now() - interval '24 hours'),
      ('7d',  now() - interval '7 days'),
      ('30d', now() - interval '30 days')
  )
  SELECT w.window_key,
         s.believers_yes, s.believers_no,
         s.yes_capital_usd, s.no_capital_usd,
         s.yes_price_usd, s.no_price_usd
  FROM windows w
  LEFT JOIN LATERAL (
    SELECT ms.believers_yes, ms.believers_no,
           ms.yes_capital_usd, ms.no_capital_usd,
           ms.yes_price_usd, ms.no_price_usd
    FROM public.market_state_snapshots ms
    WHERE ms.onchain_id = p_id AND ms.captured_at <= w.cutoff
    ORDER BY ms.captured_at DESC
    LIMIT 1
  ) s ON true;
$$;
REVOKE ALL ON FUNCTION public.market_window_baselines(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.market_window_baselines(bigint)
  TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.market_transition_state (
  onchain_id      bigint      PRIMARY KEY,
  fingerprint     text        NOT NULL,
  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  last_emitted_at timestamptz,
  seen_count      integer     NOT NULL DEFAULT 1,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.market_transition_state TO service_role;
ALTER TABLE public.market_transition_state ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.market_state
  ADD COLUMN IF NOT EXISTS yes_capital_delta_24h numeric,
  ADD COLUMN IF NOT EXISTS no_capital_delta_24h  numeric;