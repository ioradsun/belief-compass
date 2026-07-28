CREATE TABLE IF NOT EXISTS public.house_foundation_answers (
  wallet                  text NOT NULL,
  foundation_key          text NOT NULL,
  action                  text NOT NULL CHECK (action IN ('YES','NO','SKIP')),
  mapping_version         integer NOT NULL,
  dimension_contributions jsonb NOT NULL DEFAULT '{}'::jsonb,
  answered_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (wallet, foundation_key)
);
CREATE INDEX IF NOT EXISTS house_foundation_wallet_idx
  ON public.house_foundation_answers (wallet);
GRANT ALL ON public.house_foundation_answers TO service_role;
ALTER TABLE public.house_foundation_answers ENABLE ROW LEVEL SECURITY;