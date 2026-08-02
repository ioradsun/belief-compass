-- Publish wallet_beliefs to realtime so the browser can maintain the viewer's
-- positions over the one socket instead of polling.
--
-- wallet_beliefs is the single canonical current position + evaluated belief
-- state (see docs/data-ownership.md). anon already has SELECT with a permissive
-- RLS policy (wb_public_read USING(true)), so realtime will deliver changes; the
-- client subscribes FILTERED to the connected viewer's wallet (wallet=eq.<addr>)
-- so a viewer only ever receives their own position changes, not the whole book.
--
-- The client treats a change as a SIGNAL (refetch the server-valued position
-- slice), never as a delta to fold — worth is POV-valued and cost is ETH→USD
-- converted server-side, so the row alone is not renderable truth.

ALTER PUBLICATION supabase_realtime ADD TABLE public.wallet_beliefs;
