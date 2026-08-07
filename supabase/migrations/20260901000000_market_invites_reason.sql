-- MARKET INVITES — the three columns the invitation flow needs, added to the
-- table that already shipped.
--
-- The live table (20260807172914) is in several ways better than the one this
-- branch first proposed, and all of it is kept: `side`, a `code` with a real
-- default, `status` + `expires_at` (invitations go stale, which the original
-- design did not consider), a validate trigger that lowercases wallets and
-- refuses self-invites, and — importantly — a PARTIAL UNIQUE INDEX on
-- (inviter_wallet, invitee_wallet, onchain_id) WHERE status = 'pending'.
--
-- THAT INDEX ALREADY DOES THE JOB. An earlier draft of this migration added its
-- own; that would have been a second overlapping index on the same columns, and
-- a stricter one — it would have blocked re-inviting someone whose invitation
-- had been REVOKED, which is a perfectly sensible thing to want to do. Dropped.
-- One duplicate-active-invite guard, and it is the one that shipped.
--
-- So this migration is only the three columns that are genuinely missing.
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
--     NOT THE SAME THING AS `message`, which the table already has. `message` is
--     free text a human wrote; `reason` is the system's justification for
--     choosing this person, composed from measured history and never typed.
--     Merging them would make "why you" unfalsifiable, because anyone could
--     write anything into it. Two columns, two authors, two levels of trust.
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

ALTER TABLE public.market_invites
  -- Nullable, because rows already exist without one and back-filling a reason
  -- nobody wrote would be inventing what a sender said. The application refuses
  -- to SHOW an invitation without one — enforced at three layers and guarded by
  -- src/lib/invite-reason.test.ts — which is the honest handling: an old row
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
