CREATE TABLE IF NOT EXISTS public.challenges (
  id               bigserial   PRIMARY KEY,
  challenger_wallet text       NOT NULL,
  market_id        bigint      NOT NULL,
  slot_no          smallint    NOT NULL CHECK (slot_no BETWEEN 1 AND 3),
  created_at       timestamptz NOT NULL DEFAULT now(),
  closed_at        timestamptz,
  close_reason     text        CHECK (close_reason IN ('creator', 'all_responded'))
);

CREATE UNIQUE INDEX IF NOT EXISTS challenges_active_slot_idx
  ON public.challenges (challenger_wallet, slot_no)
  WHERE closed_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS challenges_active_market_idx
  ON public.challenges (challenger_wallet, market_id)
  WHERE closed_at IS NULL;

CREATE INDEX IF NOT EXISTS challenges_challenger_idx
  ON public.challenges (challenger_wallet, created_at DESC);
CREATE INDEX IF NOT EXISTS challenges_market_idx
  ON public.challenges (market_id);

GRANT ALL ON public.challenges TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.challenges_id_seq TO service_role;
ALTER TABLE public.challenges ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.challenges_normalize()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.challenger_wallet := lower(NEW.challenger_wallet);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS challenges_normalize_trg ON public.challenges;
CREATE TRIGGER challenges_normalize_trg
  BEFORE INSERT OR UPDATE ON public.challenges
  FOR EACH ROW EXECUTE FUNCTION public.challenges_normalize();

ALTER TABLE public.market_calls
  ADD COLUMN IF NOT EXISTS challenge_id bigint REFERENCES public.challenges(id);

ALTER TABLE public.market_calls
  ADD COLUMN IF NOT EXISTS passed_at timestamptz;

CREATE INDEX IF NOT EXISTS market_calls_challenge_idx
  ON public.market_calls (challenge_id)
  WHERE challenge_id IS NOT NULL;