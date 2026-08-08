-- CHALLENGE V2 — an outbound Challenge is a thing somebody CHOSE to put up.
--
-- Until now a "Challenge" was derived: a qualified person happened to trade in a
-- market you had not answered, and the system inferred a call. Nobody chose
-- anything, which is why "Sarah wants you at the table" was not a sentence the
-- data could support. `market_calls` records the RECIPIENT side of that — one row
-- per (market, caller, responder) — and it cannot represent the market-level act
-- of putting a question up: its primary key is inherently per-recipient, there is
-- no row to close, nothing to count a cap against, and no place to freeze an
-- audience. One table should not answer two questions badly, so this adds the
-- second table rather than deforming the first.
--
--   challenges    ONE ROW PER (challenger, market) — the thing on the table
--   market_calls  ONE ROW PER RECIPIENT — unchanged, still the relationship ledger
--
-- WHAT MAKES THIS SAFE UNDER RACE CONDITIONS, and it is the reason for `slot_no`.
-- The cap is three active Challenges per person. Counting rows before inserting is
-- a read-then-write race: two browser tabs both count two, both insert, and the
-- user has four. Instead each active Challenge occupies a NUMBERED SLOT, and a
-- partial unique index makes a second occupant of the same slot impossible. Two
-- tabs racing both try slot 1; one takes it, the other gets 23505 and retries into
-- slot 2. The fourth attempt finds every slot taken and fails at the database
-- rather than in a component. No trigger, no advisory lock, no counting.
--
-- The slot number is bookkeeping and must never reach a screen. "Challenge #2" is
-- not a thing anybody has; "two on the table, one spot open" is.
CREATE TABLE IF NOT EXISTS public.challenges (
  id               bigserial   PRIMARY KEY,
  -- Who put it up. Lowercased by the trigger below, like every other wallet.
  challenger_wallet text       NOT NULL,
  -- The market. Matches markets.onchain_id.
  market_id        bigint      NOT NULL,
  -- 1..3 while active. Meaningless once closed, and deliberately not reused as a
  -- display order — the cap is capacity, not a numbered inventory.
  slot_no          smallint    NOT NULL CHECK (slot_no BETWEEN 1 AND 3),
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- NULL means ON THE TABLE. Set means the slot is free again.
  closed_at        timestamptz,
  -- Why it ended, so "everyone answered" and "I took it down" stay distinguishable
  -- forever. A closed Challenge keeps its recipient rows either way.
  close_reason     text        CHECK (close_reason IN ('creator', 'all_responded'))
);

-- THE CAP, ENFORCED BY THE DATABASE. Three slots, one occupant each, only while
-- open. This single index is the whole concurrency story.
CREATE UNIQUE INDEX IF NOT EXISTS challenges_active_slot_idx
  ON public.challenges (challenger_wallet, slot_no)
  WHERE closed_at IS NULL;

-- ONE MARKET CANNOT CONSUME TWO SLOTS. Repeated taps are idempotent against this
-- rather than against a component's disabled state, so a double-submit or a second
-- tab cannot put the same question up twice.
CREATE UNIQUE INDEX IF NOT EXISTS challenges_active_market_idx
  ON public.challenges (challenger_wallet, market_id)
  WHERE closed_at IS NULL;

-- Reading somebody's table, and reading a market's Challenges.
CREATE INDEX IF NOT EXISTS challenges_challenger_idx
  ON public.challenges (challenger_wallet, created_at DESC);
CREATE INDEX IF NOT EXISTS challenges_market_idx
  ON public.challenges (market_id);

GRANT ALL ON public.challenges TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.challenges_id_seq TO service_role;
ALTER TABLE public.challenges ENABLE ROW LEVEL SECURITY;

-- Same normalisation the calls ledger already applies: a wallet is its lowercase
-- form everywhere, so a checksummed address and a lowercased one are one person.
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

-- ── the recipient ledger learns two things ──────────────────────────────────
--
-- WHICH CHALLENGE PRODUCED THIS CALL. Nullable, because rows written before V2
-- were derived and belong to no Challenge — and because the column is what freezes
-- the audience. The denominator behind "3 of 8 showed up" is COUNT(*) for a
-- challenge_id, so it cannot drift when somebody's DNA changes later. A Challenge
-- shows what it actually reached, forever.
ALTER TABLE public.market_calls
  ADD COLUMN IF NOT EXISTS challenge_id bigint REFERENCES public.challenges(id);

-- PASSED — "not for me", and the reversal deserves to be stated plainly.
--
-- Dismissal was deliberately viewer-local: no ledger of who declined whom. That
-- was right when nobody was owed an answer. V2 shows a creator what became of the
-- thing they put up, and "1 passed" cannot be honest if the server never learns
-- it — so the fact becomes durable, under three limits that keep the original
-- reasoning intact:
--
--   · It is CHALLENGE LIFECYCLE ONLY. It never touches Conviction Match and never
--     touches Showing Up, positively or negatively.
--   · The creator sees it AGGREGATED. "1 passed", not "Mike passed on you".
--   · A pass is a choice about a question, not about a person. The copy says
--     "passed"; nothing in this product says declined, rejected or ignored.
ALTER TABLE public.market_calls
  ADD COLUMN IF NOT EXISTS passed_at timestamptz;

-- Progress for one Challenge is a single index range: every recipient, and their
-- terminal state, without touching the rest of the ledger.
CREATE INDEX IF NOT EXISTS market_calls_challenge_idx
  ON public.market_calls (challenge_id)
  WHERE challenge_id IS NOT NULL;
