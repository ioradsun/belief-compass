ALTER TABLE public.market_invites
  ADD COLUMN IF NOT EXISTS reason      text,
  ADD COLUMN IF NOT EXISTS reason_kind text,
  ADD COLUMN IF NOT EXISTS viewed_at   timestamptz;

ALTER TABLE public.market_invites
  DROP CONSTRAINT IF EXISTS market_invites_reason_kind_check;
ALTER TABLE public.market_invites
  ADD CONSTRAINT market_invites_reason_kind_check
  CHECK (reason_kind IS NULL OR reason_kind IN ('adjacent', 'tribe', 'rival', 'category', 'follower'))
  NOT VALID;