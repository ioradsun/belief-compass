-- latest_trade_activity(wallets) — the most-recent canonical trade per wallet.
--
-- Replaces an over-fetch: the Network/Profile "latest activity" line used to pull
-- up to 2000 recent trade events for a set of wallets and pick the newest per
-- wallet in JS. This returns exactly one row per wallet, straight from the DB.
--
-- It's an index skip-scan: events_wallet_idx is (wallet, occurred_at DESC), so
-- DISTINCT ON (wallet) ORDER BY wallet, occurred_at DESC reads the single newest
-- row per wallet without scanning (or sorting) the full recent-trade set.
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
