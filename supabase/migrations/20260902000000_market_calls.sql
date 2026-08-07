-- MARKET CALLS — the durable record of one person's conviction asking another
-- for theirs, and whether it was answered.
--
-- WHY THIS EXISTS WHEN THE SURFACE IS DERIVED. Open Challenges need no storage
-- at all: "someone I trust took a side in a market I have not answered" is a
-- live question about current state, and `events` + `viewer_dna_cache` answer it
-- exactly. Deriving it keeps the feature stateless and always correct.
--
-- Dependability is a different kind of claim. It describes PAST social
-- behaviour — "Sarah answered my call" — and deriving that at read time lets
-- history rewrite itself: if Sarah is my Tribe today, every call she ever
-- answered retroactively becomes a Tribe call, and if she drifts to Rival
-- tomorrow they all silently become Rival calls. A record of what somebody did
-- must not change because of what they later became.
--
-- SO THE RELATIONSHIP IS FROZEN AT CALL CREATION, not at the answer. Freezing
-- it when the answer arrives would leave the same drift in the window between
-- surfacing Sarah's Challenge and Sarah responding — a window that can be days.
-- `relation_at_call` is written once, with the row, and never updated.
--
-- WHAT COUNTS AS A CALL BEING CREATED: the moment it is SURFACED to the
-- responder. A call nobody was ever shown did not happen, and that definition
-- also gives us "was it seen" without a second column.
--
-- IDEMPOTENT BY CONSTRUCTION. (market_id, caller_wallet, responder_wallet) is
-- the PRIMARY KEY, because there is no such thing as a second call from the same
-- person to the same person about the same market. Re-rendering the panel, a
-- refresh, two tabs, a retry — all one row. This is the market_invites lesson
-- applied at the start rather than after.

CREATE TABLE IF NOT EXISTS public.market_calls (
  -- The market the question lives in. Matches markets.onchain_id.
  market_id        bigint      NOT NULL,
  -- Whose conviction created the call. Lowercased by the trigger below.
  caller_wallet    text        NOT NULL,
  -- Who it is addressed to. Lowercased by the trigger below.
  responder_wallet text        NOT NULL,

  -- The canonical DNA relationship AS IT WAS when the call was made. The whole
  -- reason this table exists. Engine labels, not display text: `opp` renders as
  -- "Rival" and `inverse` as "Opp", and that mapping lives in dna-labels.
  relation_at_call text        NOT NULL,

  called_at        timestamptz NOT NULL DEFAULT now(),
  -- When the responder took a side here. Null while the call is open.
  responded_at     timestamptz,

  PRIMARY KEY (market_id, caller_wallet, responder_wallet),
  -- Your own conviction cannot ask you for your conviction.
  CONSTRAINT market_calls_not_self CHECK (caller_wallet <> responder_wallet),
  CONSTRAINT market_calls_relation CHECK (
    relation_at_call IN ('twin', 'tribe', 'opp', 'inverse')
  )
);

-- Backend-only, like follows, market_invites and viewer_dna_cache: RLS is ON
-- with no policy, so the anon key reads nothing and every access goes through a
-- server function. A call names two people and is emphatically not public.
ALTER TABLE public.market_calls ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.market_calls TO service_role;

-- "What was asked of me, and did I answer" — the Challenge surface and the
-- responder's side of Dependability.
CREATE INDEX IF NOT EXISTS market_calls_responder_idx
  ON public.market_calls (responder_wallet, called_at DESC);
-- "Who did my conviction reach, and who showed up" — SARAH SHOWED UP, and the
-- caller's side of Dependability.
CREATE INDEX IF NOT EXISTS market_calls_caller_idx
  ON public.market_calls (caller_wallet, responded_at DESC NULLS LAST);
-- Open calls only: the write path checks these on every panel render, and they
-- are a small slice of the table once the platform has any history.
CREATE INDEX IF NOT EXISTS market_calls_open_idx
  ON public.market_calls (responder_wallet, market_id)
  WHERE responded_at IS NULL;

-- Lowercasing lives here rather than only in the application for the same
-- reason it does on market_invites: a case-varying wallet would defeat the
-- primary key and quietly create a duplicate call.
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
