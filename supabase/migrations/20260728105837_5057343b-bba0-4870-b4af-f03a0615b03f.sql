CREATE TABLE IF NOT EXISTS public.market_window_change (
  onchain_id bigint NOT NULL,
  window_key text NOT NULL,
  chg_yes numeric,
  chg_no numeric,
  since_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (onchain_id, window_key)
);
GRANT ALL ON public.market_window_change TO service_role;
ALTER TABLE public.market_window_change ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.calc_cache (
  key text PRIMARY KEY,
  value numeric,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.calc_cache TO service_role;
ALTER TABLE public.calc_cache ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.refresh_market_window_change()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  w record;
  v_ids bigint[];
BEGIN
  SELECT array_agg(onchain_id) INTO v_ids FROM market_state;
  IF v_ids IS NULL THEN RETURN; END IF;

  FOR w IN
    SELECT * FROM (VALUES
      ('1h',  interval '1 hour'),
      ('24h', interval '24 hours'),
      ('7d',  interval '7 days'),
      ('30d', interval '30 days'),
      ('all', NULL::interval)
    ) AS t(k, span)
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
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_eth_usd_calibration()
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v numeric;
BEGIN
  SELECT public.eth_usd_calibration() INTO v;
  INSERT INTO calc_cache (key, value, updated_at) VALUES ('eth_usd', v, now())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  RETURN v;
END;
$$;

CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
  'refresh-market-window-change',
  '* * * * *',
  $$SELECT public.refresh_market_window_change();$$
);

SELECT cron.schedule(
  'refresh-eth-usd-calibration',
  '*/10 * * * *',
  $$SELECT public.refresh_eth_usd_calibration();$$
);

SELECT cron.schedule(
  'prune-price-snapshots',
  '17 3 * * *',
  $$DELETE FROM public.price_snapshots WHERE captured_at < now() - interval '45 days';$$
);
