-- Welcomes — belonging, one tap.
--
-- When people join a side you already hold, you can welcome them. A welcome is a
-- single durable fact: welcomer → recipient, in one tribe (market + side). The
-- UNIQUE key makes welcoming idempotent — welcoming the same person for the same
-- tribe twice is a no-op, so "Welcome all" is safe to tap again.
--
-- Reads are public (like every table here); writes are service-role only, made by
-- the sendWelcomes server function AFTER it verifies the caller controls the
-- welcomer wallet (same wallet-session proof as expressed beliefs). There is no
-- anon/authenticated INSERT grant, so the public client can never forge a welcome.

CREATE TABLE public.welcomes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  welcomer_wallet  text NOT NULL,
  recipient_wallet text NOT NULL,
  market_id        text NOT NULL,
  side             text NOT NULL,          -- YES | NO (the tribe)
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (welcomer_wallet, recipient_wallet, market_id, side)
);

-- Recipient lookups ("who welcomed me, recently") and welcomer lookups
-- ("who have I already welcomed") both hit these in recency order.
CREATE INDEX welcomes_recipient_idx ON public.welcomes (recipient_wallet, created_at DESC);
CREATE INDEX welcomes_welcomer_idx  ON public.welcomes (welcomer_wallet, created_at DESC);

GRANT SELECT ON public.welcomes TO anon, authenticated;
GRANT ALL ON public.welcomes TO service_role;
ALTER TABLE public.welcomes ENABLE ROW LEVEL SECURITY;
CREATE POLICY welcomes_public_read
  ON public.welcomes FOR SELECT TO anon, authenticated USING (true);
