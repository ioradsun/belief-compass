CREATE OR REPLACE FUNCTION public.latest_trade_activity(p_wallets text[])
RETURNS TABLE (
  wallet text,
  market_id text,
  side text,
  action text,
  occurred_at timestamptz
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT DISTINCT ON (e.wallet)
    e.wallet, e.market_id, e.side, e.action, e.occurred_at
  FROM public.events e
  WHERE e.wallet = ANY (p_wallets)
    AND e.is_canonical
    AND e.kind = 'trade'
  ORDER BY e.wallet, e.occurred_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.latest_trade_activity(text[]) TO anon, authenticated, service_role;

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