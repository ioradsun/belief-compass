ALTER TABLE public.market_state
  ADD COLUMN IF NOT EXISTS pov_updated_at        timestamptz,
  ADD COLUMN IF NOT EXISTS events_updated_at     timestamptz,
  ADD COLUMN IF NOT EXISTS positions_updated_at  timestamptz,
  ADD COLUMN IF NOT EXISTS calculated_at         timestamptz,
  ADD COLUMN IF NOT EXISTS read_model_version    bigint  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS needs_rebuild         boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rebuild_reason        text,
  ADD COLUMN IF NOT EXISTS directional_believers integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS active_positions      integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS people_no_pct         numeric,
  ADD COLUMN IF NOT EXISTS capital_held_yes      numeric,
  ADD COLUMN IF NOT EXISTS capital_held_no       numeric,
  ADD COLUMN IF NOT EXISTS capital_held_total    numeric,
  ADD COLUMN IF NOT EXISTS trade_count_1h        integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS trade_count_24h       integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS trade_count_7d        integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS buy_count_1h          integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS buy_count_24h         integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sell_count_1h         integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sell_count_24h        integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS volume_eth_1h         numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS volume_eth_24h        numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS volume_eth_7d         numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unique_wallets_1h     integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unique_wallets_24h    integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unique_wallets_7d     integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS new_believers_24h     integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS new_believers_7d      integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS side_flips_24h        integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS yes_price_change_1h   numeric,
  ADD COLUMN IF NOT EXISTS yes_price_change_24h  numeric,
  ADD COLUMN IF NOT EXISTS yes_price_change_7d   numeric,
  ADD COLUMN IF NOT EXISTS people_yes_change_24h numeric,
  ADD COLUMN IF NOT EXISTS circulation_1h        numeric,
  ADD COLUMN IF NOT EXISTS circulation_24h       numeric,
  ADD COLUMN IF NOT EXISTS circulation_7d        numeric,
  ADD COLUMN IF NOT EXISTS buy_sell_ratio_24h    numeric,
  ADD COLUMN IF NOT EXISTS sell_rate_24h         numeric,
  ADD COLUMN IF NOT EXISTS side_balance          numeric,
  ADD COLUMN IF NOT EXISTS market_created_at        timestamptz,
  ADD COLUMN IF NOT EXISTS first_trade_at           timestamptz,
  ADD COLUMN IF NOT EXISTS last_trade_at            timestamptz,
  ADD COLUMN IF NOT EXISTS last_position_change_at  timestamptz,
  ADD COLUMN IF NOT EXISTS market_age_days          numeric,
  ADD COLUMN IF NOT EXISTS inactive_for_seconds     bigint,
  ADD COLUMN IF NOT EXISTS avg_directional_days      numeric,
  ADD COLUMN IF NOT EXISTS median_directional_days   numeric,
  ADD COLUMN IF NOT EXISTS p75_directional_days      numeric,
  ADD COLUMN IF NOT EXISTS avg_conviction_strength   numeric,
  ADD COLUMN IF NOT EXISTS median_conviction_strength numeric,
  ADD COLUMN IF NOT EXISTS live_line             text,
  ADD COLUMN IF NOT EXISTS live_line_kind        text,
  ADD COLUMN IF NOT EXISTS live_line_window      text,
  ADD COLUMN IF NOT EXISTS live_line_occurred_at timestamptz,
  ADD COLUMN IF NOT EXISTS live_line_payload     jsonb,
  ADD COLUMN IF NOT EXISTS opportunity_type            text,
  ADD COLUMN IF NOT EXISTS opportunity_score           numeric,
  ADD COLUMN IF NOT EXISTS opportunity_score_raw       numeric,
  ADD COLUMN IF NOT EXISTS opportunity_reason_code     text,
  ADD COLUMN IF NOT EXISTS opportunity_reason          text,
  ADD COLUMN IF NOT EXISTS opportunity_window          text,
  ADD COLUMN IF NOT EXISTS opportunity_sample_size     integer,
  ADD COLUMN IF NOT EXISTS opportunity_confidence      text,
  ADD COLUMN IF NOT EXISTS opportunity_evidence        jsonb,
  ADD COLUMN IF NOT EXISTS opportunity_eligible        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS opportunity_ineligible_reason text,
  ADD COLUMN IF NOT EXISTS opportunity_calculated_at   timestamptz,
  ADD COLUMN IF NOT EXISTS opportunity_engine_version  integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS opportunity_type_since      timestamptz,
  ADD COLUMN IF NOT EXISTS opportunity_previous_type   text;

CREATE INDEX IF NOT EXISTS ms_needs_rebuild_idx ON public.market_state (calculated_at) WHERE needs_rebuild;
CREATE INDEX IF NOT EXISTS ms_last_trade_idx    ON public.market_state (last_trade_at DESC);
CREATE INDEX IF NOT EXISTS ms_vol24_idx         ON public.market_state (volume_eth_24h DESC);
CREATE INDEX IF NOT EXISTS ms_dir_believers_idx ON public.market_state (directional_believers DESC);
CREATE INDEX IF NOT EXISTS ms_circ24_idx        ON public.market_state (circulation_24h DESC);
CREATE INDEX IF NOT EXISTS ms_opportunity_feed_idx
  ON public.market_state (opportunity_score DESC, opportunity_calculated_at DESC, onchain_id)
  WHERE opportunity_eligible = true;
CREATE INDEX IF NOT EXISTS ms_opportunity_type_idx
  ON public.market_state (opportunity_type, opportunity_score DESC)
  WHERE opportunity_eligible = true;

CREATE INDEX IF NOT EXISTS events_market_trade_time_idx
  ON public.events (market_id, occurred_at)
  WHERE is_canonical = true AND kind = 'trade';
CREATE INDEX IF NOT EXISTS events_market_transition_idx
  ON public.events (market_id, kind, occurred_at)
  WHERE is_canonical = true AND source = 'system';
CREATE INDEX IF NOT EXISTS wb_market_side_idx   ON public.wallet_beliefs (onchain_id, stance_side);
CREATE INDEX IF NOT EXISTS wb_market_dirsince_idx ON public.wallet_beliefs (onchain_id, directional_since);

CREATE TABLE IF NOT EXISTS public.market_refresh_queue (
  market_id       bigint PRIMARY KEY,
  activity_dirty  boolean NOT NULL DEFAULT false,
  positions_dirty boolean NOT NULL DEFAULT false,
  pov_dirty       boolean NOT NULL DEFAULT false,
  requested_at    timestamptz NOT NULL DEFAULT now(),
  attempts        integer NOT NULL DEFAULT 0,
  last_error      text
);
CREATE INDEX IF NOT EXISTS mrq_requested_idx ON public.market_refresh_queue (requested_at);
ALTER TABLE public.market_refresh_queue ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.market_refresh_queue TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_market_refresh(p_market_ids bigint[], p_kind text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n integer := 0;
BEGIN
  WITH ids AS (SELECT DISTINCT unnest(p_market_ids) AS market_id),
  ins AS (
    INSERT INTO market_refresh_queue (market_id, activity_dirty, positions_dirty, pov_dirty, requested_at)
    SELECT market_id,
           p_kind = 'activity', p_kind = 'positions', p_kind = 'pov', now()
    FROM ids
    ON CONFLICT (market_id) DO UPDATE SET
      activity_dirty  = market_refresh_queue.activity_dirty  OR (p_kind = 'activity'),
      positions_dirty = market_refresh_queue.positions_dirty OR (p_kind = 'positions'),
      pov_dirty       = market_refresh_queue.pov_dirty       OR (p_kind = 'pov'),
      requested_at    = LEAST(market_refresh_queue.requested_at, now())
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM ins;
  RETURN v_n;
END; $$;
REVOKE ALL ON FUNCTION public.enqueue_market_refresh(bigint[], text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_market_refresh(bigint[], text) TO service_role;

CREATE OR REPLACE FUNCTION public.market_event_windows(p_market bigint, p_now timestamptz)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $$
  WITH e AS (
    SELECT action, occurred_at, wallet, (amount_eth / 1e18) AS eth
    FROM events
    WHERE market_id = p_market::text AND is_canonical = true AND kind = 'trade'
  )
  SELECT jsonb_build_object(
    'trade_count_1h',  count(*) FILTER (WHERE occurred_at >= p_now - interval '1 hour'),
    'trade_count_24h', count(*) FILTER (WHERE occurred_at >= p_now - interval '24 hours'),
    'trade_count_7d',  count(*) FILTER (WHERE occurred_at >= p_now - interval '7 days'),
    'buy_count_1h',    count(*) FILTER (WHERE action='BUY'  AND occurred_at >= p_now - interval '1 hour'),
    'buy_count_24h',   count(*) FILTER (WHERE action='BUY'  AND occurred_at >= p_now - interval '24 hours'),
    'sell_count_1h',   count(*) FILTER (WHERE action='SELL' AND occurred_at >= p_now - interval '1 hour'),
    'sell_count_24h',  count(*) FILTER (WHERE action='SELL' AND occurred_at >= p_now - interval '24 hours'),
    'volume_eth_1h',   COALESCE(sum(eth) FILTER (WHERE occurred_at >= p_now - interval '1 hour'), 0),
    'volume_eth_24h',  COALESCE(sum(eth) FILTER (WHERE occurred_at >= p_now - interval '24 hours'), 0),
    'volume_eth_7d',   COALESCE(sum(eth) FILTER (WHERE occurred_at >= p_now - interval '7 days'), 0),
    'unique_wallets_1h',  count(DISTINCT wallet) FILTER (WHERE occurred_at >= p_now - interval '1 hour'),
    'unique_wallets_24h', count(DISTINCT wallet) FILTER (WHERE occurred_at >= p_now - interval '24 hours'),
    'unique_wallets_7d',  count(DISTINCT wallet) FILTER (WHERE occurred_at >= p_now - interval '7 days'),
    'first_trade_at', min(occurred_at),
    'last_trade_at',  max(occurred_at),
    'total_trades',   count(*)
  ) FROM e;
$$;
GRANT EXECUTE ON FUNCTION public.market_event_windows(bigint, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.market_position_aggregates(p_market bigint, p_now timestamptz)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $$
  WITH wb AS (
    SELECT b.wallet, b.stance_side, b.yes_shares, b.no_shares, b.yes_cost, b.no_cost,
           b.conviction, b.directional_since
    FROM wallet_beliefs b
    WHERE b.onchain_id = p_market
      AND NOT EXISTS (SELECT 1 FROM wallet_denylist d WHERE d.wallet = b.wallet)
  ),
  dir AS (
    SELECT conviction,
           GREATEST(0, EXTRACT(EPOCH FROM (p_now - directional_since)) / 86400.0) AS days
    FROM wb WHERE stance_side IN ('YES','NO') AND directional_since IS NOT NULL
  )
  SELECT jsonb_build_object(
    'believers_yes',   (SELECT count(*) FROM wb WHERE stance_side='YES'),
    'believers_no',    (SELECT count(*) FROM wb WHERE stance_side='NO'),
    'mixed_wallets',   (SELECT count(*) FROM wb WHERE stance_side='MIXED'),
    'active_positions',(SELECT count(*) FROM wb WHERE yes_shares > 0 OR no_shares > 0),
    'capital_held_yes',(SELECT COALESCE(sum(yes_cost),0) FROM wb),
    'capital_held_no', (SELECT COALESCE(sum(no_cost),0) FROM wb),
    'avg_directional_days',    (SELECT avg(days) FROM dir),
    'median_directional_days', (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY days) FROM dir),
    'p75_directional_days',    (SELECT percentile_cont(0.75) WITHIN GROUP (ORDER BY days) FROM dir),
    'avg_conviction_strength',    (SELECT avg(conviction) FROM dir),
    'median_conviction_strength', (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY conviction) FROM dir)
  );
$$;
GRANT EXECUTE ON FUNCTION public.market_position_aggregates(bigint, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.market_transition_windows(p_market bigint, p_now timestamptz)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $$
  WITH t AS (
    SELECT kind, occurred_at, payload->>'new_side' AS new_side
    FROM events
    WHERE market_id = p_market::text AND is_canonical = true AND source = 'system'
      AND kind IN ('position_became_directional','position_changed_side',
                   'position_became_mixed','position_became_inactive')
  )
  SELECT jsonb_build_object(
    'new_believers_1h',  count(*) FILTER (WHERE kind='position_became_directional' AND occurred_at >= p_now - interval '1 hour'),
    'new_believers_24h', count(*) FILTER (WHERE kind='position_became_directional' AND occurred_at >= p_now - interval '24 hours'),
    'new_believers_7d',  count(*) FILTER (WHERE kind='position_became_directional' AND occurred_at >= p_now - interval '7 days'),
    'side_flips_24h',    count(*) FILTER (WHERE kind='position_changed_side' AND occurred_at >= p_now - interval '24 hours'),
    'last_position_change_at', max(occurred_at),
    'nb_side_24h', (
      SELECT CASE WHEN y >= n AND y > 0 THEN 'YES' WHEN n > 0 THEN 'NO' ELSE NULL END FROM (
        SELECT count(*) FILTER (WHERE new_side='YES') AS y, count(*) FILTER (WHERE new_side='NO') AS n
        FROM t WHERE kind='position_became_directional' AND occurred_at >= p_now - interval '24 hours'
      ) s
    )
  ) FROM t;
$$;
GRANT EXECUTE ON FUNCTION public.market_transition_windows(bigint, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_market_refresh(p_limit integer)
RETURNS TABLE(market_id bigint, activity_dirty boolean, positions_dirty boolean, pov_dirty boolean, requested_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM market_refresh_queue q
  WHERE q.market_id IN (
    SELECT s.market_id FROM market_refresh_queue s
    ORDER BY s.requested_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING q.market_id, q.activity_dirty, q.positions_dirty, q.pov_dirty, q.requested_at;
$$;
REVOKE ALL ON FUNCTION public.claim_market_refresh(integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_market_refresh(integer) TO service_role;

SELECT cron.schedule('conviction-market-refresher','*/1 * * * *', $$
  SELECT net.http_post(
    url := 'https://project--c585b86f-545d-455e-9e85-a94f5211e352.lovable.app/api/public/jobs/market-refresher',
    headers := jsonb_build_object('Content-Type','application/json',
      'Authorization','Bearer '||(SELECT value FROM private.config WHERE key='ingest_secret')),
    body := '{}'::jsonb);
$$);