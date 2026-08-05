-- FOLLOWS — the one signal a brand-new viewer can produce.
--
-- Conviction DNA is inferred: it needs shared beliefs before it can call anyone
-- a Twin or a Rival, and until then a viewer's network is empty. That is fine
-- for a mature account and useless for a new one, so every "what should we show
-- this person" path currently falls back to global popularity.
--
-- A follow is the deliberate version of the same statement, available on the
-- first day: "this person is worth my attention." It feeds ranking beside the
-- inferred relationships rather than replacing them — following someone does
-- not make them your Tribe, and being in your Tribe does not mean you followed
-- them. Two different facts, both true, kept separate.
--
-- WHAT IT IS NOT. Not a filter — a followed person's markets rank higher, they
-- do not become the only markets. Not mutual, not announced, and not a
-- permission: everything here is already public on-chain, so a follow grants
-- the follower no access they did not have.
--
-- ONE ROW PER PAIR. Unfollowing DELETES rather than flagging: a follow is a
-- current statement of interest, not a history worth keeping, and a table that
-- accumulates every toggle would make "who do I follow" a filtered query
-- forever after.

CREATE TABLE IF NOT EXISTS public.follows (
  -- The viewer doing the following. Lowercased by the write path.
  follower  text        NOT NULL,
  -- The person being followed. Lowercased by the write path.
  followed  text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower, followed),
  -- Following yourself would rank your own markets up for you, which is the one
  -- thing a discovery feed must not do.
  CONSTRAINT follows_not_self CHECK (follower <> followed)
);

-- Backend-only, like share_codes and viewer_dna_cache: RLS is ON with no
-- policy, so the anon/publishable key reads nothing and every access goes
-- through a server function that has already verified wallet ownership.
ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.follows TO service_role;

-- "Who do I follow" — the ranking read, on every personalised feed build.
CREATE INDEX IF NOT EXISTS follows_follower_idx ON public.follows (follower);
-- "Who follows this person" — the count on a profile.
CREATE INDEX IF NOT EXISTS follows_followed_idx ON public.follows (followed);
