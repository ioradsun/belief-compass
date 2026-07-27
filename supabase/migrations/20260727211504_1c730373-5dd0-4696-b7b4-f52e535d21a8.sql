-- Remove public read access from sensitive / internal tables.
DROP POLICY IF EXISTS "trades_public_read" ON public.trades;
DROP POLICY IF EXISTS "fe_public_read" ON public.feed_events;
DROP POLICY IF EXISTS "ingest_state_public_read" ON public.ingest_state;
DROP POLICY IF EXISTS "wb_public_read" ON public.wallet_beliefs;
DROP POLICY IF EXISTS "wallet_links public read" ON public.wallet_links;

REVOKE SELECT ON public.trades FROM anon, authenticated;
REVOKE SELECT ON public.feed_events FROM anon, authenticated;
REVOKE SELECT ON public.ingest_state FROM anon, authenticated;
REVOKE SELECT ON public.wallet_beliefs FROM anon, authenticated;
REVOKE SELECT ON public.wallet_links FROM anon, authenticated;

GRANT ALL ON public.trades TO service_role;
GRANT ALL ON public.feed_events TO service_role;
GRANT ALL ON public.ingest_state TO service_role;
GRANT ALL ON public.wallet_beliefs TO service_role;
GRANT ALL ON public.wallet_links TO service_role;

-- Tighten the always-true anonymous insert policy on user_events.
DROP POLICY IF EXISTS "ue_public_insert" ON public.user_events;
CREATE POLICY "ue_public_insert" ON public.user_events
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    type IN ('view','dwell','click','open','close','swipe','impression')
    AND (wallet IS NULL OR wallet = lower(wallet))
    AND (session_id IS NULL OR length(session_id) <= 128)
    AND (dwell_ms IS NULL OR (dwell_ms >= 0 AND dwell_ms <= 3600000))
  );