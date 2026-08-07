CREATE TABLE IF NOT EXISTS public.market_calls (
  market_id        bigint      NOT NULL,
  caller_wallet    text        NOT NULL,
  responder_wallet text        NOT NULL,
  relation_at_call text        NOT NULL,
  called_at        timestamptz NOT NULL DEFAULT now(),
  responded_at     timestamptz,
  PRIMARY KEY (market_id, caller_wallet, responder_wallet),
  CONSTRAINT market_calls_not_self CHECK (caller_wallet <> responder_wallet),
  CONSTRAINT market_calls_relation CHECK (
    relation_at_call IN ('twin', 'tribe', 'opp', 'inverse')
  )
);

GRANT ALL ON public.market_calls TO service_role;
ALTER TABLE public.market_calls ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS market_calls_responder_idx
  ON public.market_calls (responder_wallet, called_at DESC);
CREATE INDEX IF NOT EXISTS market_calls_caller_idx
  ON public.market_calls (caller_wallet, responded_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS market_calls_open_idx
  ON public.market_calls (responder_wallet, market_id)
  WHERE responded_at IS NULL;

CREATE OR REPLACE FUNCTION public.market_calls_normalize()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.caller_wallet := lower(NEW.caller_wallet);
  NEW.responder_wallet := lower(NEW.responder_wallet);
  IF NEW.caller_wallet = NEW.responder_wallet THEN
    RAISE EXCEPTION 'a conviction cannot call its own author';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS market_calls_normalize ON public.market_calls;
CREATE TRIGGER market_calls_normalize
BEFORE INSERT OR UPDATE ON public.market_calls
FOR EACH ROW EXECUTE FUNCTION public.market_calls_normalize();

DROP TABLE IF EXISTS public.market_invites CASCADE;
DROP FUNCTION IF EXISTS public.market_invites_validate() CASCADE;
DROP TABLE IF EXISTS public.welcomes CASCADE;
DROP TABLE IF EXISTS public.welcome_room_visits CASCADE;