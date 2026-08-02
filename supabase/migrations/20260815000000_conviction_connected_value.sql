-- conviction_connected_value: the aggregation behind conviction.company/value.
--
-- The report card measures the value that flows through wallets CONNECTED to
-- conviction.company — not the whole POV ecosystem. A connected wallet is either
-- side of a wallet_links row (the conviction sign-in wallet, or the pov.co
-- trading wallet the user linked to it). We attribute a wallet's trading across
-- ANY market, pov- or conviction-born: a connected user backing a pov-only market
-- is still value Conviction brought.
--
-- Done in SQL because the connected set can be large and events is a firehose;
-- the join rides events_wallet_idx (wallet, occurred_at). Everything returned is
-- REAL trade data — money (fees/creator earnings) is derived on the client from
-- the contract's own fee rate, never invented here.

CREATE OR REPLACE FUNCTION public.conviction_connected_value(p_growth_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH conv AS (
    SELECT lower(connected_wallet) AS wallet FROM public.wallet_links WHERE connected_wallet IS NOT NULL
    UNION
    SELECT lower(linked_wallet)    AS wallet FROM public.wallet_links WHERE linked_wallet IS NOT NULL
  ),
  tr AS (
    SELECT
      e.market_id,
      lower(e.wallet) AS wallet,
      e.side,
      e.action,
      e.amount_eth,
      e.occurred_at
    FROM public.events e
    JOIN conv c ON lower(e.wallet) = c.wallet
    WHERE e.is_canonical
      AND e.kind = 'trade'
      AND e.wallet IS NOT NULL
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
    'connectedWallets', (SELECT count(*) FROM conv),
    'trades',           (SELECT count(*) FROM tr),
    'buys',             (SELECT count(*) FROM tr WHERE action = 'BUY'),
    'traders',          (SELECT count(DISTINCT wallet) FROM tr),
    'buyWei',           (SELECT coalesce(sum(amount_eth) FILTER (WHERE action = 'BUY'), 0)::text FROM tr),
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

GRANT EXECUTE ON FUNCTION public.conviction_connected_value(integer) TO anon, authenticated, service_role;
