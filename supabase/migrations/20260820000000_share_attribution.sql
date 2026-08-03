-- Share attribution — the foundation for "See your impact".
--
-- When someone shares a market and their tribe arrives, we want to honestly
-- answer one question for the sharer: "what did your link bring in?" — link
-- opens, wallets connected, new believers, and capital committed. This is
-- ATTRIBUTION ONLY: no rewards, no fees, no on-chain mechanics. It records who
-- arrived via whom, and the impact is COMPUTED at read time by joining those
-- arrivals against the canonical wallet_beliefs — never a second source of
-- truth for believers or capital.
--
-- Two tables:
--   share_codes  — a stable, human-readable code per sharer wallet (the ?r=).
--   share_visits — one row per (link, market, visitor): the open, and the
--                  wallet once that visitor connects one.

-- ── share_codes ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.share_codes (
  code       text PRIMARY KEY,
  wallet     text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.share_codes ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.share_codes TO service_role;

-- ── share_visits ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.share_visits (
  id           bigserial PRIMARY KEY,
  ref_code     text        NOT NULL,
  market_id    bigint,
  -- Anonymous per-browser id (localStorage). Lets us dedupe an open and later
  -- bind it to a wallet without any account.
  visitor_id   text        NOT NULL,
  -- Filled once (and if) this visitor connects a wallet.
  wallet       text,
  opened_at    timestamptz NOT NULL DEFAULT now(),
  connected_at timestamptz
);
ALTER TABLE public.share_visits ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.share_visits TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.share_visits_id_seq TO service_role;

-- One open per (link, market, visitor): re-opens update, never pile up.
CREATE UNIQUE INDEX IF NOT EXISTS share_visits_dedupe_idx
  ON public.share_visits (ref_code, market_id, visitor_id);
-- Impact reads scan by the sharer's code; conversions bind by visitor / wallet.
CREATE INDEX IF NOT EXISTS share_visits_ref_idx     ON public.share_visits (ref_code);
CREATE INDEX IF NOT EXISTS share_visits_visitor_idx ON public.share_visits (visitor_id);
CREATE INDEX IF NOT EXISTS share_visits_wallet_idx  ON public.share_visits (wallet) WHERE wallet IS NOT NULL;
