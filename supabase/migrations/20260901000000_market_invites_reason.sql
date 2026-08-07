-- MARKET INVITES — the three columns the invitation flow needs, added to the
-- table that already shipped.
--
-- The live table arrived with a different and in places better shape than the
-- one this branch proposed: `side` (which side the inviter is recommending),
-- `code` (a shareable handle), and `status` + `expires_at` (invitations go
-- stale, which the original design did not consider and should have). All of
-- that is kept. This migration is purely additive.
--
-- WHAT IS MISSING, and why each is load-bearing rather than nice to have.
--
-- 1 · `reason` — THE POINT OF THE FEATURE. `roomReason` already composes the
--     sentence ("You agree 87% of the time across 12 markets") and today it
--     renders for the sender and is thrown away. Composing it once at SEND time
--     and keeping it is what lets the recipient see WHY THEY were chosen, at the
--     moment they were chosen, rather than a sentence that has since drifted.
--     Without it the For You shelf cannot render an invitation at all: the rule
--     in @/domain/for-you is that a row with no reason does not exist, and there
--     is deliberately no fallback string to fall back to.
--
-- 2 · `reason_kind` — which audience the inviter picked them from. It is what
--     makes "which audience actually converts" answerable in check-launch. A
--     recruitment panel that cannot tell you whether Adjacent beats Tribe is
--     five guesses in a trench coat.
--
-- 3 · `viewed_at` — the first rung of the outcome ladder. `accepted_at` already
--     covers "they joined"; the gap between reaching someone and moving them is
--     the whole thing Launch Progress exists to show, and without a view stamp
--     the ladder starts at its second step.
--
-- AND ONE CONSTRAINT. Uniqueness currently sits on `code`, which makes each
-- SEND unique rather than each RELATIONSHIP. Two taps of Invite, a double
-- click, a refresh or a retry therefore produce two rows with two codes, and
-- the recipient's shelf stacks. The partial unique index below puts uniqueness
-- back on (market, inviter, invitee) so idempotence is structural rather than
-- something every caller has to remember. It is PARTIAL — excluding rows whose
-- invitation was declined or expired — so a person can be invited again later
-- once the first attempt is genuinely over, which is a real thing to want and
-- a strict constraint would forbid.

ALTER TABLE public.market_invites
  -- Nullable, because rows already exist without one and back-filling a reason
  -- nobody wrote would be inventing what a sender said. The application refuses
  -- to SHOW an invitation without one, which is the honest handling: an old row
  -- stays in the table and never claims a justification it does not have.
  ADD COLUMN IF NOT EXISTS reason      text,
  ADD COLUMN IF NOT EXISTS reason_kind text,
  ADD COLUMN IF NOT EXISTS viewed_at   timestamptz;

-- Constrained rather than free text, so a typo cannot create an unlabelled row
-- that no report can group. NOT VALID: it binds every future write without
-- forcing a rewrite of rows that predate the column.
ALTER TABLE public.market_invites
  DROP CONSTRAINT IF EXISTS market_invites_reason_kind_check;
ALTER TABLE public.market_invites
  ADD CONSTRAINT market_invites_reason_kind_check
  CHECK (reason_kind IS NULL OR reason_kind IN ('adjacent', 'tribe', 'rival', 'category', 'follower'))
  NOT VALID;

-- ONE INVITATION PER RELATIONSHIP, not per send.
CREATE UNIQUE INDEX IF NOT EXISTS market_invites_one_per_pair_idx
  ON public.market_invites (onchain_id, inviter_wallet, invitee_wallet)
  WHERE status IS NULL OR status NOT IN ('declined', 'expired');

-- "What is waiting for me" — the For You shelf, on every load.
CREATE INDEX IF NOT EXISTS market_invites_invitee_idx
  ON public.market_invites (invitee_wallet, created_at DESC);
-- "What have I sent" — the per-inviter rate limit, and Launch Progress.
CREATE INDEX IF NOT EXISTS market_invites_inviter_idx
  ON public.market_invites (inviter_wallet, created_at DESC);
-- "Who was invited here, and what came of it" — Launch Progress for one market.
CREATE INDEX IF NOT EXISTS market_invites_market_idx
  ON public.market_invites (onchain_id);
