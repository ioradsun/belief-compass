-- Viewer market decisions — V1 "remove completed markets from discovery".
--
-- One row per (viewer, market) recording the FIRST real decision a viewer made on
-- a market: a confirmed YES/NO purchase, or a PASS. This is the SINGLE source of
-- truth for excluding a market from the normal discovery queue — never inferred
-- from token balances, belief tables, or House prediction history.
--
-- V1 rule: the first completed decision wins (writes are ON CONFLICT DO NOTHING).
-- Not reachable from the browser: every access goes through a server function
-- using the service-role client, so no anon/authenticated grants are issued and
-- RLS denies by default.

CREATE TABLE public.viewer_market_decisions (
  viewer_wallet text NOT NULL,
  market_id bigint NOT NULL,
  decision text NOT NULL CHECK (decision IN ('YES', 'NO', 'PASS')),
  decided_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (viewer_wallet, market_id)
);

-- The feed reads every completed market id for one viewer on each load.
CREATE INDEX viewer_market_decisions_wallet_idx
  ON public.viewer_market_decisions (viewer_wallet);

ALTER TABLE public.viewer_market_decisions ENABLE ROW LEVEL SECURITY;
