-- latest_trades_per_market(ids, per) — the newest `per` canonical trades for
-- EACH market, in one call.
--
-- Replaces an over-fetch: the feed's per-market pulse strips pulled the 1200
-- globally-newest trade events across all visible markets and sliced to 8 each
-- in JS — which both over-reads and can starve a quiet market (its rows fall
-- outside the global 1200). This returns exactly `per` rows per market.
--
-- LATERAL top-N over events_market_trade_time_idx (market_id, occurred_at): for
-- each id, seek the market and walk newest-first, stopping at `per`.
CREATE OR REPLACE FUNCTION public.latest_trades_per_market(p_ids text[], p_per int)
RETURNS TABLE (
  source_key text,
  source text,
  kind text,
  market_id text,
  wallet text,
  side text,
  action text,
  amount_eth numeric,
  shares numeric,
  price numeric,
  chain_id bigint,
  block_number bigint,
  log_index integer,
  occurred_at timestamptz
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT e.source_key, e.source, e.kind, e.market_id, e.wallet, e.side, e.action,
         e.amount_eth, e.shares, e.price, e.chain_id, e.block_number, e.log_index,
         e.occurred_at
  FROM unnest(p_ids) AS m(id)
  CROSS JOIN LATERAL (
    SELECT ev.*
    FROM public.events ev
    WHERE ev.market_id = m.id
      AND ev.is_canonical
      AND ev.kind = 'trade'
    ORDER BY ev.occurred_at DESC, ev.block_number DESC NULLS LAST, ev.log_index DESC NULLS LAST
    LIMIT p_per
  ) e;
$$;

GRANT EXECUTE ON FUNCTION public.latest_trades_per_market(text[], int) TO anon, authenticated, service_role;
