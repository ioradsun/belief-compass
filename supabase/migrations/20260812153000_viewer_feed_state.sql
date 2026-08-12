-- viewer_feed_state — a per-wallet projection of the viewer overlay.
--
-- The feed's personalization needs the viewer's held positions and their
-- passed/hidden decisions, which today cost several relationship and history
-- queries on every request (see loadViewerSignals). This table denormalizes the
-- viewer-global part of that answer into ONE indexed row so the overlay is one
-- read, not many.
--
-- IT IS A DURABLE CACHE, NOT A SOURCE OF TRUTH. The rows in wallet_beliefs,
-- viewer_market_events and viewer_market_decisions remain authoritative; this is
-- refreshed opportunistically when the viewer passes/hides/sells and rebuilt on
-- a stale read, so a position or follow change that did not push is caught by
-- the next rebuild rather than served wrong forever. A stale row costs a few
-- bytes and is overwritten on the next build.
--
-- RLS is on with no policy, so no client role can read it directly: only
-- service-role server code (which bypasses RLS) touches it. The payload is
-- viewer-private interaction state and must never be reachable with anon/auth
-- keys.
CREATE TABLE IF NOT EXISTS public.viewer_feed_state (
  wallet text PRIMARY KEY,
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.viewer_feed_state TO service_role;

ALTER TABLE public.viewer_feed_state ENABLE ROW LEVEL SECURITY;
