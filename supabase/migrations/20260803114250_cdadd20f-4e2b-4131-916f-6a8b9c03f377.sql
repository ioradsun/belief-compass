CREATE TABLE IF NOT EXISTS public.share_codes (
  code       text PRIMARY KEY,
  wallet     text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.share_codes ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.share_codes TO service_role;

CREATE TABLE IF NOT EXISTS public.share_visits (
  id           bigserial PRIMARY KEY,
  ref_code     text        NOT NULL,
  market_id    bigint,
  visitor_id   text        NOT NULL,
  wallet       text,
  opened_at    timestamptz NOT NULL DEFAULT now(),
  connected_at timestamptz
);
ALTER TABLE public.share_visits ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.share_visits TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.share_visits_id_seq TO service_role;

CREATE UNIQUE INDEX IF NOT EXISTS share_visits_dedupe_idx
  ON public.share_visits (ref_code, market_id, visitor_id);
CREATE INDEX IF NOT EXISTS share_visits_ref_idx     ON public.share_visits (ref_code);
CREATE INDEX IF NOT EXISTS share_visits_visitor_idx ON public.share_visits (visitor_id);
CREATE INDEX IF NOT EXISTS share_visits_wallet_idx  ON public.share_visits (wallet) WHERE wallet IS NOT NULL;