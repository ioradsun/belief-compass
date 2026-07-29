CREATE TABLE public.conviction_markets (
  question_id text PRIMARY KEY,
  onchain_id bigint UNIQUE,
  format text NOT NULL DEFAULT 'text',
  question text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'Other',
  category_source text NOT NULL DEFAULT 'ai',
  creator_fee_bps integer,
  side text NOT NULL DEFAULT 'YES',
  stake_amount_usd numeric,
  seed_eth_wei text,
  usd_per_eth_at_creation numeric,
  pov_boost boolean NOT NULL DEFAULT false,
  pov_boost_spend_degen text,
  media jsonb,
  curve_address text,
  yes_agent text,
  no_agent text,
  yes_token text,
  no_token text,
  creator_wallet text NOT NULL,
  chain_id bigint NOT NULL DEFAULT 8453,
  contract_address text NOT NULL,
  transaction_hash text,
  status text NOT NULL DEFAULT 'draft',
  last_error text,
  moderation_status text NOT NULL DEFAULT 'ok',
  hidden boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.conviction_markets TO anon, authenticated;
GRANT ALL ON public.conviction_markets TO service_role;
ALTER TABLE public.conviction_markets ENABLE ROW LEVEL SECURITY;

CREATE POLICY cm_public_read ON public.conviction_markets
  FOR SELECT TO anon, authenticated
  USING (status = 'active' AND hidden = false AND moderation_status <> 'blocked');

CREATE INDEX cm_creator_idx ON public.conviction_markets (creator_wallet, created_at DESC);
CREATE INDEX cm_status_idx ON public.conviction_markets (status, created_at DESC);

CREATE TABLE public.market_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id text,
  onchain_id bigint,
  reporter_wallet text,
  reason text NOT NULL,
  details text,
  resolved boolean NOT NULL DEFAULT false,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.market_reports TO service_role;
ALTER TABLE public.market_reports ENABLE ROW LEVEL SECURITY;

CREATE INDEX mr_open_idx ON public.market_reports (resolved, created_at DESC);

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.touch_updated_at() FROM anon, authenticated;

CREATE TRIGGER conviction_markets_touch
  BEFORE UPDATE ON public.conviction_markets
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER market_reports_touch
  BEFORE UPDATE ON public.market_reports
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();