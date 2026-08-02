-- conviction_trades: exact attribution for conviction.company/value.
--
-- WHY THIS EXISTS. There is no on-chain signal for "which app routed this trade":
-- the contract's buy(marketId, yes, minTokens) takes no referrer, so a trade sent
-- from conviction.company is indistinguishable on-chain from the same wallet's
-- trade on pov.co. Wallet-based guessing was wrong in both directions (wallet_links
-- is a one-way identity link — the linked pov.co wallet trades on POV, not here).
-- The only place the truth exists is the moment WE send the transaction, so we
-- record it there. This table is that record.
--
-- IT IS ONLY A TAG. No money lives here. Every figure on /value comes from the
-- canonical events log joined to these tx hashes, so a transaction that reverts,
-- is dropped, or never mines contributes nothing — it simply never gets an event.
--
-- INTEGRITY. Rows are written by a server function under service-role (there is no
-- anon/authenticated INSERT grant, so the public client can never forge one). We
-- record at SUBMIT time, before the transaction is mined, and the read side below
-- requires recorded_at to precede the block time. Replaying somebody else's public
-- tx hash therefore fails: by the time a hash is observable it is already mined.
--
-- Attribution starts the day this ships. Trades sent before it are unrecoverable
-- and are NOT estimated — /value counts only what it can prove.

CREATE TABLE IF NOT EXISTS public.conviction_trades (
  tx_hash     text PRIMARY KEY,
  wallet      text NOT NULL,
  market_id   text,
  side        text,                    -- YES | NO
  action      text,                    -- BUY | SELL
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

-- Public read (like every table here); writes are service-role only.
CREATE POLICY conviction_trades_public_read ON public.conviction_trades
  FOR SELECT TO anon, authenticated USING (true);

-- The wallet-scoped guess this replaces.
DROP FUNCTION IF EXISTS public.conviction_connected_value(integer);

-- conviction_attributed_value: the aggregation behind /value.
--
-- events (chain truth: what happened, for how much) INNER JOIN conviction_trades
-- (our truth: we sent it). Nothing else counts.
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
     -- Recorded before the block that mined it: a replayed public hash cannot
     -- satisfy this, since it is only observable once already mined. The grace
     -- window absorbs clock skew between our server and the chain.
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
