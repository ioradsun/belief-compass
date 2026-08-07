-- MARKET INVITES — one person asking another to join a specific debate.
--
-- WHY A TABLE AND NOT A MESSAGE. There is no notification channel on this
-- platform: no email, no web push, no service worker, no inbox, no unread
-- state. `user_events` has zero insert sites. The only cross-person primitives
-- that exist are `welcomes` (retrospective, side-locked, zero payload) and
-- `share_visits` (anonymous — the sharer never learns who they invited).
--
-- So an invitation cannot notify anyone, and pretending otherwise would be the
-- worst version of this feature. An invitation is a STORED ROW the recipient
-- finds in-app the next time they look, which makes the For You shelf the
-- entire delivery mechanism rather than a garnish.
--
-- THE KEY IS THE IDEMPOTENCE. (market_id, from_wallet, to_wallet) is the
-- PRIMARY KEY, not a unique index over a surrogate id, because there is no such
-- thing as a second invitation from the same person to the same person about
-- the same market. A resend, a double-click, a refresh and a retry are all the
-- same row by construction — the recipient's shelf cannot be stacked even by a
-- caller trying to. Two DIFFERENT people may both invite you to one market, and
-- that is a real fact the shelf can say out loud, so `from_wallet` is in the key.
--
-- THE REASON IS STORED, NOT RECOMPUTED. `roomReason` already composes the
-- sentence this needs — "You agree 87% of the time across 12 markets" — from
-- `viewer_dna_cache`. Composing it once at SEND time and keeping it is what
-- makes the invitation honest: the recipient sees why the sender picked them at
-- the moment they picked them, not a sentence that has since drifted because
-- one of them changed their mind about something unrelated.
--
-- OUTCOMES, NOT EFFORT. `viewed_at` and `joined_at` exist so Launch Progress can
-- measure what happened rather than what was sent. An invitation is not an
-- achievement; a person arriving is.

CREATE TABLE IF NOT EXISTS public.market_invites (
  -- The market being recommended. Matches markets.onchain_id.
  market_id   bigint      NOT NULL,
  -- Who sent it. Lowercased by the write path, which has PROVEN this wallet —
  -- see verifiedActor in welcomes.functions.ts. An invitation carries one
  -- person's name into another person's interface, so a claimed wallet is not
  -- good enough.
  from_wallet text        NOT NULL,
  -- Who it is for. Lowercased by the write path.
  to_wallet   text        NOT NULL,

  -- The sentence the recipient reads, composed once at send time.
  reason      text        NOT NULL,
  -- Which audience the sender picked them from. Constrained rather than free
  -- text so a typo cannot create an unlabelled row that no reader can group.
  reason_kind text        NOT NULL,

  created_at  timestamptz NOT NULL DEFAULT now(),
  -- The outcome ladder: Viewed → Joined. Both null until they happen.
  viewed_at   timestamptz,
  joined_at   timestamptz,

  PRIMARY KEY (market_id, from_wallet, to_wallet),
  CONSTRAINT market_invites_not_self CHECK (from_wallet <> to_wallet),
  CONSTRAINT market_invites_reason_not_blank CHECK (length(btrim(reason)) > 0),
  CONSTRAINT market_invites_reason_kind CHECK (
    reason_kind IN ('adjacent', 'tribe', 'rival', 'category', 'follower')
  )
);

-- Backend-only, like follows, share_codes and viewer_dna_cache: RLS is ON with
-- no policy, so the anon/publishable key reads nothing and every access goes
-- through a server function that has already verified wallet ownership. An
-- invitation names both people, so it is emphatically not anon-readable.
ALTER TABLE public.market_invites ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.market_invites TO service_role;

-- "What is waiting for me" — the For You shelf, on every load.
CREATE INDEX IF NOT EXISTS market_invites_to_idx
  ON public.market_invites (to_wallet, created_at DESC);
-- "What have I sent" — the per-creator rate limit, and Launch Progress.
CREATE INDEX IF NOT EXISTS market_invites_from_idx
  ON public.market_invites (from_wallet, created_at DESC);
-- "Who was invited here, and what came of it" — Launch Progress for one market.
CREATE INDEX IF NOT EXISTS market_invites_market_idx
  ON public.market_invites (market_id);
