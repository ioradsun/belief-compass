-- Window-open baselines for believers & capital (time-range audit D3).
--
-- getMarketChange pulls only the latest 1000 canonical trades, so on a market
-- with >1000 lifetime trades the client reducer cannot see the state as it stood
-- when a window opened — the window baseline (and any % measured against it) is
-- understated. This snapshots the AUTHORITATIVE market_state totals on every poll
-- and reads the nearest snapshot at/older than each window boundary as the
-- baseline, exactly the shape recompute_price_changes already uses over
-- price_snapshots for the price %. Capital and price are USD here (market_state's
-- own units); believers are the directional per-side counts.

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

-- The only access pattern: "latest snapshot at/older than a cutoff, for a market".
CREATE INDEX IF NOT EXISTS market_state_snapshots_id_time
  ON public.market_state_snapshots (onchain_id, captured_at DESC);

ALTER TABLE public.market_state_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS market_state_snapshots_read ON public.market_state_snapshots;
CREATE POLICY market_state_snapshots_read
  ON public.market_state_snapshots FOR SELECT USING (true);

-- Append one snapshot per market from the current authoritative state. The poller
-- calls this each cycle (like recompute_price_changes), so a ~2-minute-resolution
-- history accumulates. Idempotency isn't needed: each cycle is a distinct instant.
CREATE OR REPLACE FUNCTION public.snapshot_market_state()
RETURNS integer
LANGUAGE plpgsql
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
GRANT EXECUTE ON FUNCTION public.snapshot_market_state() TO service_role, authenticated;

-- Per-window baseline for ONE market: the nearest snapshot at/older than each
-- window's cutoff. Mirrors the ago1/ago24 CTEs in recompute_price_changes. A
-- window with no old-enough snapshot returns NULLs (the caller reads that as
-- "no baseline yet" → show the absolute total with no % move).
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
GRANT EXECUTE ON FUNCTION public.market_window_baselines(bigint)
  TO anon, authenticated, service_role;
