-- conviction_trades: server-only
DROP POLICY IF EXISTS conviction_trades_public_read ON public.conviction_trades;
REVOKE SELECT ON public.conviction_trades FROM anon, authenticated;
GRANT ALL ON public.conviction_trades TO service_role;

-- wallet_denylist: server-only (hides moderation logic)
DROP POLICY IF EXISTS wd_public_read ON public.wallet_denylist;
REVOKE SELECT ON public.wallet_denylist FROM anon, authenticated;
GRANT ALL ON public.wallet_denylist TO service_role;

-- profile_overrides: server-only
DROP POLICY IF EXISTS profile_overrides_public_read ON public.profile_overrides;
REVOKE SELECT ON public.profile_overrides FROM anon, authenticated;
GRANT ALL ON public.profile_overrides TO service_role;

-- events: scope public read to the live-feed slice, safe columns only
DROP POLICY IF EXISTS events_public_read ON public.events;
REVOKE SELECT ON public.events FROM anon, authenticated;
GRANT SELECT (source_key, source, kind, market_id, wallet, side, action,
              amount_eth, shares, price, chain_id, block_number, log_index,
              occurred_at, is_canonical)
  ON public.events TO anon, authenticated;
GRANT ALL ON public.events TO service_role;
CREATE POLICY events_live_trades_read ON public.events
  FOR SELECT TO anon, authenticated
  USING (is_canonical AND kind = 'trade' AND occurred_at > now() - interval '3 days');

-- user_events: no unauthenticated wallet-attributed inserts
DROP POLICY IF EXISTS ue_public_insert ON public.user_events;
REVOKE INSERT ON public.user_events FROM anon, authenticated;
GRANT ALL ON public.user_events TO service_role;