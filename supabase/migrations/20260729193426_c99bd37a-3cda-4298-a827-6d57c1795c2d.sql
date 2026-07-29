CREATE TABLE public.welcomes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  welcomer_wallet  text NOT NULL,
  recipient_wallet text NOT NULL,
  market_id        text NOT NULL,
  side             text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (welcomer_wallet, recipient_wallet, market_id, side)
);

CREATE INDEX welcomes_recipient_idx ON public.welcomes (recipient_wallet, created_at DESC);
CREATE INDEX welcomes_welcomer_idx  ON public.welcomes (welcomer_wallet, created_at DESC);

GRANT SELECT ON public.welcomes TO anon, authenticated;
GRANT ALL ON public.welcomes TO service_role;
ALTER TABLE public.welcomes ENABLE ROW LEVEL SECURITY;
CREATE POLICY welcomes_public_read
  ON public.welcomes FOR SELECT TO anon, authenticated USING (true);