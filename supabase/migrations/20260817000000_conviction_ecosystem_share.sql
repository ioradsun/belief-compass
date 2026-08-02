-- conviction_ecosystem_share: Conviction's slice of the whole POV ecosystem.
--
-- The story on /value is not "here are our numbers" — it is "here is the whole
-- market, and here is how much of it we now account for." So this returns the
-- COMBINED totals (pov + conviction) alongside Conviction's contribution, and the
-- page divides the two into a share that starts at 0.00% and grows.
--
-- Two different histories, deliberately:
--   * MARKETS share is real all the way back. markets.source has been stamped
--     'conviction' at creation since the beginning, so this is genuine history.
--   * VOLUME share begins when trade attribution shipped (conviction_trades). The
--     contract carries no referrer, so earlier trades cannot be attributed and are
--     NOT estimated — the volume share is honestly 0.00% before that point.
--
-- Returns daily buckets plus a baseline (everything before the window) so the page
-- can draw a true cumulative curve without scanning all history client-side.

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
  -- Every buy in the ecosystem, flagged with whether Conviction routed it.
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
  -- Every market in the ecosystem, flagged with whether it was born here.
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
    -- Lifetime totals — the headline share.
    'totals', jsonb_build_object(
      'ecoBuyWei',   (SELECT coalesce(sum(amount_eth), 0)::text FROM buys),
      'convBuyWei',  (SELECT coalesce(sum(amount_eth) FILTER (WHERE is_conviction), 0)::text FROM buys),
      'ecoMarkets',  (SELECT count(*) FROM mk),
      'convMarkets', (SELECT count(*) FROM mk WHERE is_conviction)
    ),
    -- Everything before the window, so the curve starts at the true running total.
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
