-- Remember which way someone went, after they have gone.
--
-- `expressed_side` answers "where do they stand NOW" and becomes INACTIVE the
-- moment a position is closed, taking the direction with it. Nothing else on the
-- row survives to say which side was held, so Shared DNA — which reads only
-- directional rows — lost every agreement two people ever had in a market as
-- soon as either of them exited it.
--
-- That is not rare. 43.5% of all wallet-market positions in production are fully
-- exited, and rerunning the DNA engine over "any side ever held" instead of
-- "held right now" takes pairs with eight or more shared convictions from 22 to
-- 174. This column is what lets a past conviction keep counting (at PAST_WEIGHT
-- — see src/domain/dna/config.ts).
--
-- WHAT IT HOLDS: the MOST RECENT directional side. One field, one answer. A
-- wallet that went YES → exit → NO → exit reads NO, and the earlier YES is gone.
-- DNA is one factor per market, so the latest conviction is the right single
-- representation — but no copy may claim "we remember every time you agreed",
-- because we do not. "Past convictions still count, with less weight than
-- positions you hold today" is what is true.
--
-- WRITTEN BY THE REDUCER, not by SQL. applyTrade() in src/domain/domain.ts sets
-- it whenever a position becomes directional; the RPCs below only persist what
-- the reducer produced, exactly as they do for every other reducer-owned field.

ALTER TABLE public.wallet_beliefs
  ADD COLUMN IF NOT EXISTS last_directional_side text
    CHECK (last_directional_side IN ('YES','NO'));

COMMENT ON COLUMN public.wallet_beliefs.last_directional_side IS
  'Most recent YES/NO side held in this market. Set by the reducer when the position is directional; NEVER cleared on partial sell, exit, or straddle. Not a full episode history — one field holds the latest side only.';

-- Finding "wallets that once held a side here" is the whole point, and it is a
-- different question from the live-side lookup wb_market_stance_idx serves.
CREATE INDEX IF NOT EXISTS wb_market_last_side_idx
  ON public.wallet_beliefs (onchain_id, last_directional_side)
  WHERE last_directional_side IS NOT NULL;
CREATE INDEX IF NOT EXISTS wb_wallet_last_side_idx
  ON public.wallet_beliefs (wallet, last_directional_side)
  WHERE last_directional_side IS NOT NULL;

-- ── The write path ───────────────────────────────────────────────────────────
--
-- NEVER CLEARED, and that rule lives HERE rather than only in the caller.
-- COALESCE(NULLIF(new,''), existing) means a payload that omits the field, or
-- sends an empty string, keeps whatever is stored. The reducer is already
-- monotone — it only ever assigns a real side — so this is defence in depth: a
-- future caller, a partial payload, or a rebuild that legitimately folds zero
-- events cannot erase a remembered conviction. There is no code path that turns
-- a YES or a NO back into NULL.

CREATE OR REPLACE FUNCTION public.apply_position_events(
  p_wallet         text,
  p_market         bigint,
  p_expected_version bigint,
  p_state          jsonb,
  p_cursor         jsonb,
  p_applied_count  bigint,
  p_state_hash     text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row        wallet_beliefs%ROWTYPE;
  v_new_block  bigint := NULLIF(p_cursor->>'block_number','')::bigint;
  v_new_log    integer := NULLIF(p_cursor->>'log_index','')::integer;
  v_advances   boolean;
BEGIN
  SELECT * INTO v_row FROM wallet_beliefs
   WHERE wallet = p_wallet AND onchain_id = p_market
   FOR UPDATE;

  IF NOT FOUND THEN
    IF p_expected_version <> 0 THEN
      RETURN jsonb_build_object('conflict', true, 'reason', 'missing_row');
    END IF;
    INSERT INTO wallet_beliefs (
      wallet, onchain_id,
      yes_shares, no_shares, yes_cost, no_cost, expressed_side,
      last_directional_side,
      directional_since, first_backed_at, last_trade_at,
      stance, stance_side, conviction, days_held,
      last_applied_event_id, last_applied_source_key,
      last_applied_block_number, last_applied_log_index,
      position_version, applied_trade_count, needs_rebuild, state_hash,
      last_evaluated_at, updated_at
    ) VALUES (
      p_wallet, p_market,
      (p_state->>'yes_shares')::numeric, (p_state->>'no_shares')::numeric,
      (p_state->>'yes_cost')::numeric, (p_state->>'no_cost')::numeric,
      p_state->>'expressed_side',
      NULLIF(p_state->>'last_directional_side',''),
      NULLIF(p_state->>'directional_since','')::timestamptz,
      NULLIF(p_state->>'first_backed_at','')::timestamptz,
      NULLIF(p_state->>'last_trade_at','')::timestamptz,
      NULLIF(p_state->>'stance','')::numeric, NULLIF(p_state->>'stance_side',''),
      COALESCE(NULLIF(p_state->>'conviction','')::numeric, 0),
      COALESCE(NULLIF(p_state->>'days_held','')::numeric, 0),
      NULLIF(p_cursor->>'event_id','')::uuid, p_cursor->>'source_key',
      v_new_block, v_new_log,
      1, p_applied_count, false, p_state_hash,
      NULLIF(p_state->>'last_evaluated_at','')::timestamptz, now()
    )
    ON CONFLICT (wallet, onchain_id) DO NOTHING;
    IF FOUND THEN
      RETURN jsonb_build_object('ok', true, 'new_version', 1, 'disposition', 'created');
    END IF;
    RETURN jsonb_build_object('conflict', true, 'reason', 'concurrent_create');
  END IF;

  IF v_row.needs_rebuild THEN
    RETURN jsonb_build_object('disposition', 'rebuild_required');
  END IF;
  IF v_row.position_version <> p_expected_version THEN
    RETURN jsonb_build_object('conflict', true, 'current_version', v_row.position_version);
  END IF;

  v_advances := v_row.last_applied_block_number IS NULL
             OR v_new_block > v_row.last_applied_block_number
             OR (v_new_block = v_row.last_applied_block_number
                 AND v_new_log > v_row.last_applied_log_index);
  IF NOT v_advances THEN
    RETURN jsonb_build_object('disposition', 'replay');
  END IF;

  UPDATE wallet_beliefs SET
    yes_shares        = (p_state->>'yes_shares')::numeric,
    no_shares         = (p_state->>'no_shares')::numeric,
    yes_cost          = (p_state->>'yes_cost')::numeric,
    no_cost           = (p_state->>'no_cost')::numeric,
    expressed_side    = p_state->>'expressed_side',
    -- Monotone: a remembered side is never overwritten with nothing.
    last_directional_side = COALESCE(
      NULLIF(p_state->>'last_directional_side',''), last_directional_side),
    directional_since = NULLIF(p_state->>'directional_since','')::timestamptz,
    first_backed_at   = NULLIF(p_state->>'first_backed_at','')::timestamptz,
    last_trade_at     = NULLIF(p_state->>'last_trade_at','')::timestamptz,
    stance            = CASE WHEN p_state ? 'stance' THEN NULLIF(p_state->>'stance','')::numeric ELSE stance END,
    stance_side       = CASE WHEN p_state ? 'stance_side' THEN NULLIF(p_state->>'stance_side','') ELSE stance_side END,
    conviction        = CASE WHEN p_state ? 'conviction' THEN NULLIF(p_state->>'conviction','')::numeric ELSE conviction END,
    days_held         = CASE WHEN p_state ? 'days_held' THEN NULLIF(p_state->>'days_held','')::numeric ELSE days_held END,
    last_evaluated_at = CASE WHEN p_state ? 'last_evaluated_at' THEN NULLIF(p_state->>'last_evaluated_at','')::timestamptz ELSE last_evaluated_at END,
    last_applied_event_id     = NULLIF(p_cursor->>'event_id','')::uuid,
    last_applied_source_key   = p_cursor->>'source_key',
    last_applied_block_number = v_new_block,
    last_applied_log_index    = v_new_log,
    position_version          = v_row.position_version + 1,
    applied_trade_count       = v_row.applied_trade_count + p_applied_count,
    state_hash                = p_state_hash,
    updated_at                = now()
  WHERE wallet = p_wallet AND onchain_id = p_market;

  RETURN jsonb_build_object('ok', true, 'new_version', v_row.position_version + 1,
                            'disposition', 'applied');
END $$;

-- rebuild_position writes the same reducer-owned field under the same rule.
-- Its `empty` payload deliberately omits the side, which COALESCEs to whatever
-- is stored: rebuilding a pair that currently folds to zero events must not
-- forget a conviction the tape once showed.
DO $$
DECLARE v_src text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'rebuild_position'
   LIMIT 1;
  IF v_src IS NULL THEN
    RAISE NOTICE 'rebuild_position not found; skipping';
    RETURN;
  END IF;
  IF v_src LIKE '%last_directional_side%' THEN
    RAISE NOTICE 'rebuild_position already carries last_directional_side';
    RETURN;
  END IF;
  -- Persist the field alongside expressed_side, under the same COALESCE rule.
  v_src := replace(
    v_src,
    'expressed_side    = p_state->>''expressed_side'',',
    'expressed_side    = p_state->>''expressed_side'',' || chr(10) ||
    '    last_directional_side = COALESCE(NULLIF(p_state->>''last_directional_side'',''''), last_directional_side),'
  );
  EXECUTE v_src;
END $$;

-- ── Backfill ─────────────────────────────────────────────────────────────────
--
-- Only the part that is unambiguous: a position that is directional RIGHT NOW
-- has a last directional side, and it is the one it is holding.
--
-- Everything else — the exited positions, which are the entire reason this
-- column exists — is deliberately NOT backfilled here. Their side is only
-- recoverable by replaying the trade tape, and it must be replayed through the
-- production reducer (applyTrade) rather than reconstructed in SQL, because a
-- second implementation of share/cost/side math is exactly the failure this
-- codebase keeps having. The transition-event log is NOT a safe substitute
-- either: the tape shows 75 side switches where only 26 position_changed_side
-- events exist, so an event-driven backfill would confidently write wrong sides
-- for two thirds of them.
--
-- Run `npm run backfill:last-directional-side` after this migration.
UPDATE public.wallet_beliefs
   SET last_directional_side = stance_side
 WHERE last_directional_side IS NULL
   AND stance_side IN ('YES','NO');

UPDATE public.wallet_beliefs
   SET last_directional_side = expressed_side
 WHERE last_directional_side IS NULL
   AND expressed_side IN ('YES','NO');

-- ── The read path ────────────────────────────────────────────────────────────
--
-- The candidate generator only ever saw LIVE directional rows, so two people
-- whose entire overlap is in markets they have both closed were not candidates
-- at all — the exact relationships this column exists to recover. A remembered
-- side now contributes a candidate row like any other.
--
-- Ranking is unchanged in kind: `weighted_evidence` still orders the pool. A
-- remembered belief carries conviction 0 on its row (there is no live position
-- to value), so it contributes no evidence weight and sorts below live overlap
-- — which is the correct priority for a bounded pool. The DISCOUNT that decides
-- what a memory is worth lives in the scorer (PAST_WEIGHT), not here; this
-- function's job is only to decide who gets scored at all.
CREATE OR REPLACE FUNCTION public.find_match_candidates(
  p_viewer         text,
  p_min_shared     int DEFAULT 5,
  p_max_candidates int DEFAULT 500
)
RETURNS TABLE (
  wallet                  text,
  shared_markets          int,
  same_side               int,
  opposite_side           int,
  weighted_evidence       numeric,
  last_shared_activity_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH beliefs AS (
    -- Held right now.
    SELECT wallet, onchain_id, stance_side, GREATEST(conviction, 0) AS conviction, last_trade_at
    FROM public.wallet_beliefs
    WHERE stance_side IN ('YES','NO')
    UNION ALL
    -- Held once, since left. Same wallet-market can never appear twice: this
    -- arm requires the live side to be absent.
    SELECT wallet, onchain_id, last_directional_side AS stance_side,
           0::numeric AS conviction, last_trade_at
    FROM public.wallet_beliefs
    WHERE stance_side IS DISTINCT FROM 'YES'
      AND stance_side IS DISTINCT FROM 'NO'
      AND last_directional_side IN ('YES','NO')
    UNION ALL
    -- Expressed freely, where no on-chain position of any kind exists.
    SELECT eb.wallet, eb.onchain_id, eb.side AS stance_side,
           GREATEST(eb.weight, 0) AS conviction, eb.updated_at AS last_trade_at
    FROM public.expressed_beliefs eb
    WHERE NOT EXISTS (
      SELECT 1 FROM public.wallet_beliefs wb2
      WHERE wb2.wallet = eb.wallet AND wb2.onchain_id = eb.onchain_id
        AND (wb2.stance_side IN ('YES','NO') OR wb2.last_directional_side IN ('YES','NO'))
    )
  ),
  viewer AS (
    SELECT onchain_id, stance_side, conviction
    FROM beliefs
    WHERE wallet = lower(p_viewer)
  ),
  pop AS (
    SELECT b.onchain_id, count(*)::numeric AS participants
    FROM beliefs b
    JOIN viewer v ON v.onchain_id = b.onchain_id
    GROUP BY b.onchain_id
  ),
  cand AS (
    SELECT
      b.wallet,
      (b.stance_side = v.stance_side) AS same,
      sqrt(v.conviction * GREATEST(b.conviction, 0))
        * (1.0 / log(2.0, 2 + COALESCE(p.participants, 0))) AS ev,
      b.last_trade_at
    FROM beliefs b
    JOIN viewer v ON v.onchain_id = b.onchain_id
    LEFT JOIN pop p ON p.onchain_id = b.onchain_id
    WHERE b.wallet <> lower(p_viewer)
      AND NOT EXISTS (SELECT 1 FROM public.wallet_denylist d WHERE d.wallet = b.wallet)
  )
  SELECT
    wallet,
    count(*)::int AS shared_markets,
    count(*) FILTER (WHERE same)::int AS same_side,
    count(*) FILTER (WHERE NOT same)::int AS opposite_side,
    sum(ev) AS weighted_evidence,
    max(last_trade_at) AS last_shared_activity_at
  FROM cand
  GROUP BY wallet
  HAVING count(*) >= p_min_shared
  ORDER BY sum(ev) DESC, count(*) DESC, wallet ASC
  LIMIT p_max_candidates
$$;
GRANT EXECUTE ON FUNCTION public.find_match_candidates(text, int, int)
  TO anon, authenticated, service_role;
