CREATE TABLE IF NOT EXISTS public.conviction_trades (
  tx_hash     text PRIMARY KEY,
  wallet      text NOT NULL,
  market_id   text,
  side        text,
  action      text,
  chain_id    bigint,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS conviction_trades_recorded_idx
  ON public.conviction_trades (recorded_at DESC);
CREATE INDEX IF NOT EXISTS conviction_trades_wallet_idx
  ON public.conviction_trades (wallet, recorded_at DESC);

GRANT SELECT ON public.conviction_trades TO anon, authenticated;
GRANT ALL    ON public.conviction_trades TO service_role;
ALTER TABLE public.conviction_trades ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conviction_trades_public_read ON public.conviction_trades;
CREATE POLICY conviction_trades_public_read ON public.conviction_trades
  FOR SELECT TO anon, authenticated USING (true);

CREATE OR REPLACE FUNCTION public.conviction_attributed_value(p_growth_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH tr AS (
    SELECT
      e.market_id,
      lower(e.wallet) AS wallet,
      e.side,
      e.action,
      e.amount_eth,
      e.occurred_at
    FROM public.events e
    JOIN public.conviction_trades ct
      ON lower(ct.tx_hash) = lower(e.tx_hash)
     AND ct.recorded_at <= e.occurred_at + interval '30 seconds'
    WHERE e.is_canonical
      AND e.kind = 'trade'
      AND e.tx_hash IS NOT NULL
  ),
  per_market AS (
    SELECT
      market_id,
      count(*)                                                   AS trades,
      coalesce(sum(amount_eth) FILTER (WHERE action = 'BUY'), 0) AS buy_wei
    FROM tr
    GROUP BY market_id
  ),
  by_day AS (
    SELECT
      to_char(date_trunc('day', occurred_at AT TIME ZONE 'utc'), 'YYYY-MM-DD') AS day,
      count(*)                                                   AS trades,
      coalesce(sum(amount_eth) FILTER (WHERE action = 'BUY'), 0) AS buy_wei
    FROM tr
    WHERE occurred_at >= (now() - make_interval(days => p_growth_days))
    GROUP BY 1
  ),
  recent AS (
    SELECT market_id, wallet, side, action, amount_eth, occurred_at
    FROM tr
    ORDER BY occurred_at DESC
    LIMIT 24
  )
  SELECT jsonb_build_object(
    'trades',  (SELECT count(*) FROM tr),
    'buys',    (SELECT count(*) FROM tr WHERE action = 'BUY'),
    'traders', (SELECT count(DISTINCT wallet) FROM tr),
    'buyWei',  (SELECT coalesce(sum(amount_eth) FILTER (WHERE action = 'BUY'), 0)::text FROM tr),
    'since',   (SELECT min(recorded_at) FROM public.conviction_trades),
    'perMarket', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'marketId', market_id,
        'trades',   trades,
        'buyWei',   buy_wei::text
      )), '[]'::jsonb) FROM per_market
    ),
    'byDay', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'day',    day,
        'trades', trades,
        'buyWei', buy_wei::text
      ) ORDER BY day), '[]'::jsonb) FROM by_day
    ),
    'recent', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'marketId',  market_id,
        'wallet',    wallet,
        'side',      side,
        'action',    action,
        'amountEth', amount_eth::text,
        'at',        occurred_at
      ) ORDER BY occurred_at DESC), '[]'::jsonb) FROM recent
    )
  );
$$;

GRANT EXECUTE ON FUNCTION public.conviction_attributed_value(integer) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.conviction_ecosystem_share(p_days integer DEFAULT 90)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH bounds AS (
    SELECT (now() - make_interval(days => p_days)) AS start_ts
  ),
  buys AS (
    SELECT
      e.occurred_at,
      e.amount_eth,
      (ct.tx_hash IS NOT NULL) AS is_conviction
    FROM public.events e
    LEFT JOIN public.conviction_trades ct
      ON lower(ct.tx_hash) = lower(e.tx_hash)
     AND ct.recorded_at <= e.occurred_at + interval '30 seconds'
    WHERE e.is_canonical
      AND e.kind = 'trade'
      AND e.action = 'BUY'
  ),
  mk AS (
    SELECT
      coalesce(m.created_at, m.first_seen) AS at,
      (m.source = 'conviction')            AS is_conviction
    FROM public.markets m
  ),
  buys_by_day AS (
    SELECT
      to_char(date_trunc('day', b.occurred_at AT TIME ZONE 'utc'), 'YYYY-MM-DD')     AS day,
      coalesce(sum(b.amount_eth), 0)                                                 AS eco_wei,
      coalesce(sum(b.amount_eth) FILTER (WHERE b.is_conviction), 0)                  AS conv_wei
    FROM buys b, bounds
    WHERE b.occurred_at >= bounds.start_ts
    GROUP BY 1
  ),
  mk_by_day AS (
    SELECT
      to_char(date_trunc('day', m.at AT TIME ZONE 'utc'), 'YYYY-MM-DD')              AS day,
      count(*)                                                                       AS eco_markets,
      count(*) FILTER (WHERE m.is_conviction)                                        AS conv_markets
    FROM mk m, bounds
    WHERE m.at >= bounds.start_ts
    GROUP BY 1
  )
  SELECT jsonb_build_object(
    'totals', jsonb_build_object(
      'ecoBuyWei',   (SELECT coalesce(sum(amount_eth), 0)::text FROM buys),
      'convBuyWei',  (SELECT coalesce(sum(amount_eth) FILTER (WHERE is_conviction), 0)::text FROM buys),
      'ecoMarkets',  (SELECT count(*) FROM mk),
      'convMarkets', (SELECT count(*) FROM mk WHERE is_conviction)
    ),
    'baseline', jsonb_build_object(
      'ecoBuyWei',   (SELECT coalesce(sum(b.amount_eth), 0)::text FROM buys b, bounds WHERE b.occurred_at < bounds.start_ts),
      'convBuyWei',  (SELECT coalesce(sum(b.amount_eth) FILTER (WHERE b.is_conviction), 0)::text FROM buys b, bounds WHERE b.occurred_at < bounds.start_ts),
      'ecoMarkets',  (SELECT count(*) FROM mk m, bounds WHERE m.at < bounds.start_ts),
      'convMarkets', (SELECT count(*) FROM mk m, bounds WHERE m.at < bounds.start_ts AND m.is_conviction)
    ),
    'byDay', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'day',         d.day,
        'ecoBuyWei',   coalesce(b.eco_wei, 0)::text,
        'convBuyWei',  coalesce(b.conv_wei, 0)::text,
        'ecoMarkets',  coalesce(k.eco_markets, 0),
        'convMarkets', coalesce(k.conv_markets, 0)
      ) ORDER BY d.day), '[]'::jsonb)
      FROM (
        SELECT day FROM buys_by_day
        UNION
        SELECT day FROM mk_by_day
      ) d
      LEFT JOIN buys_by_day b ON b.day = d.day
      LEFT JOIN mk_by_day   k ON k.day = d.day
    )
  );
$$;

GRANT EXECUTE ON FUNCTION public.conviction_ecosystem_share(integer) TO anon, authenticated, service_role;