CREATE TABLE public.market_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL DEFAULT encode(gen_random_bytes(9), 'base64'),
  inviter_wallet text NOT NULL,
  invitee_wallet text,
  onchain_id bigint NOT NULL,
  side text CHECK (side IN ('YES','NO')),
  message text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','declined','expired','revoked')),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at timestamptz,
  accepted_by_wallet text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.market_invites TO service_role;

ALTER TABLE public.market_invites ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX market_invites_code_key ON public.market_invites (code);
CREATE UNIQUE INDEX market_invites_pending_unique
  ON public.market_invites (inviter_wallet, invitee_wallet, onchain_id)
  WHERE invitee_wallet IS NOT NULL AND status = 'pending';
CREATE INDEX market_invites_invitee_idx
  ON public.market_invites (invitee_wallet, status, created_at DESC);
CREATE INDEX market_invites_market_idx
  ON public.market_invites (onchain_id, status);

CREATE OR REPLACE FUNCTION public.market_invites_validate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.inviter_wallet := lower(NEW.inviter_wallet);
  NEW.invitee_wallet := lower(NEW.invitee_wallet);
  NEW.accepted_by_wallet := lower(NEW.accepted_by_wallet);
  IF NEW.invitee_wallet IS NOT NULL AND NEW.invitee_wallet = NEW.inviter_wallet THEN
    RAISE EXCEPTION 'cannot invite yourself';
  END IF;
  IF NEW.status = 'pending' AND NEW.expires_at <= now() THEN
    RAISE EXCEPTION 'expires_at must be in the future for a pending invite';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER market_invites_validate
BEFORE INSERT OR UPDATE ON public.market_invites
FOR EACH ROW EXECUTE FUNCTION public.market_invites_validate();