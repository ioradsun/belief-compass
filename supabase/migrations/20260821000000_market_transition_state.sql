-- Dedup / anti-spam store for market transitions in the UNIVERSAL feed.
--
-- The center panel shows the strongest CURRENT market interpretation live. The
-- universal feed is stricter: a transition ("YES is accelerating", "the market is
-- becoming divided", "price moved but conviction did not") belongs there only when
-- it is genuinely news — Tier 1-2, NEW, PERSISTENT (not a one-cycle flicker), and
-- NOT a restatement of one it just showed.
--
-- This table holds ONE row per market: the currently-tracked transition episode
-- (its fingerprint = type + side), when it was first/last seen, when it was last
-- emitted, and how many consecutive passes have observed it. The refresher reads
-- it, runs the pure src/domain/transition-emit decision, writes a
-- kind='market_transition' event only when it clears the bar, and upserts the row.
-- Emitted transitions are ordinary idempotent events (source_key), so the live
-- tape renders them alongside trades with no new read path.

CREATE TABLE IF NOT EXISTS public.market_transition_state (
  onchain_id      bigint      PRIMARY KEY,
  fingerprint     text        NOT NULL,
  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  last_emitted_at timestamptz,
  seen_count      integer     NOT NULL DEFAULT 1,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Service-role only: the refresher reads and writes this; nothing client-facing
-- touches it. RLS on with no public policy (service_role bypasses RLS).
ALTER TABLE public.market_transition_state ENABLE ROW LEVEL SECURITY;
