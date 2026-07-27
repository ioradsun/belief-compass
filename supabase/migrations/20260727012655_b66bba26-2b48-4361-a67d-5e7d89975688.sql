CREATE TABLE public.wallet_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connected_wallet text NOT NULL,
  linked_wallet text NOT NULL,
  signature text,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connected_wallet, linked_wallet)
);
CREATE INDEX wallet_links_connected_idx ON public.wallet_links (connected_wallet);

GRANT SELECT ON public.wallet_links TO anon;
GRANT SELECT ON public.wallet_links TO authenticated;
GRANT ALL ON public.wallet_links TO service_role;

ALTER TABLE public.wallet_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wallet_links public read" ON public.wallet_links FOR SELECT USING (true);