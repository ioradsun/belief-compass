CREATE TABLE IF NOT EXISTS public.viewer_market_decisions (
  viewer_wallet text NOT NULL,
  market_id bigint NOT NULL,
  decision text NOT NULL CHECK (decision IN ('YES','NO','PASS')),
  decided_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (viewer_wallet, market_id)
);

CREATE INDEX IF NOT EXISTS viewer_market_decisions_wallet_idx
  ON public.viewer_market_decisions (viewer_wallet, decided_at DESC);

GRANT ALL ON public.viewer_market_decisions TO service_role;

ALTER TABLE public.viewer_market_decisions ENABLE ROW LEVEL SECURITY;