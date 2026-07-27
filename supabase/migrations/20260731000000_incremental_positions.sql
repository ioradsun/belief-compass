-- Phase 3 — incremental, exactly-once position state.
--
-- wallet_beliefs BECOMES the canonical current wallet-market position state
-- (no second positions table). This migration adds application metadata (cursor,
-- version, dirty flags, state hash) and NARROW write RPCs that lock + validate +
-- persist reducer state supplied by the TypeScript reducer. The RPCs NEVER
-- reimplement share/cost/expressed-side math — applyTrade() in src/domain/domain.ts
-- remains the single behavioral source of truth.
--
--   events         = immutable canonical history
--   wallet_beliefs = canonical current position + evaluated belief state
--   trades         = temporary compatibility projection (rollback/parity only)

-- ── Application metadata ─────────────────────────────────────────────────────
ALTER TABLE public.wallet_beliefs
  ADD COLUMN IF NOT EXISTS last_applied_event_id     uuid,
  ADD COLUMN IF NOT EXISTS last_applied_source_key   text,
  ADD COLUMN IF NOT EXISTS last_applied_block_number bigint,
  ADD COLUMN IF NOT EXISTS last_applied_log_index    integer,
  ADD COLUMN IF NOT EXISTS position_version          bigint  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS applied_trade_count       bigint  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS needs_rebuild             boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rebuild_reason            text,
  ADD COLUMN IF NOT EXISTS rebuild_requested_at      timestamptz,
  ADD COLUMN IF NOT EXISTS rebuilt_at                timestamptz,
  ADD COLUMN IF NOT EXISTS state_hash                text,
  ADD COLUMN IF NOT EXISTS last_evaluated_at         timestamptz;

-- FK to the canonical event (safe: events are never deleted, only orphaned).
DO $$ BEGIN
  ALTER TABLE public.wallet_beliefs
    ADD CONSTRAINT wallet_beliefs_last_event_fk
    FOREIGN KEY (last_applied_event_id) REFERENCES public.events(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Dirty-pair worker scan.
CREATE INDEX IF NOT EXISTS wb_needs_rebuild_idx
  ON public.wallet_beliefs (rebuild_requested_at)
  WHERE needs_rebuild = true;
-- Recovery: find pairs whose cursor is behind canonical history.
CREATE INDEX IF NOT EXISTS wb_cursor_idx
  ON public.wallet_beliefs (last_applied_block_number, last_applied_log_index);

-- ── apply_position_events — the narrow incremental write ──────────────────────
-- Locks the wallet-market row, validates optimistic version + canonical cursor
-- advance, then persists the reducer state the CALLER computed. Handles first
-- creation (expected_version = 0 and no row). Returns a disposition/conflict so
-- the caller can retry or mark the pair dirty. NO reducer math here.
CREATE OR REPLACE FUNCTION public.apply_position_events(
  p_wallet         text,
  p_market         bigint,
  p_expected_version bigint,
  p_state          jsonb,   -- reducer + (optional) evaluated fields to write
  p_cursor         jsonb,   -- {event_id, source_key, block_number, log_index}
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
      NULLIF(p_state->>'directional_since','')::timestamptz,
      NULLIF(p_state->>'first_backed_at','')::timestamptz,
      NULLIF(p_state->>'last_trade_at','')::timestamptz,
      NULLIF(p_state->>'stance','')::numeric, NULLIF(p_state->>'stance_side',''),
      -- conviction/days_held are NOT NULL: default to 0 when prices are pending.
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
    -- Lost a concurrent create → caller reloads and applies.
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
    directional_since = NULLIF(p_state->>'directional_since','')::timestamptz,
    first_backed_at   = NULLIF(p_state->>'first_backed_at','')::timestamptz,
    last_trade_at     = NULLIF(p_state->>'last_trade_at','')::timestamptz,
    -- Evaluated fields only when the caller supplied them (prices available).
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
END;
$$;

-- ── rebuild_position — authoritative full replace from canonical history ──────
-- The caller (rebuilder) has folded ALL canonical events for the pair in TS.
-- This locks + writes the final state, resets the cursor, clears the dirty flag.
CREATE OR REPLACE FUNCTION public.rebuild_position(
  p_wallet        text,
  p_market        bigint,
  p_state         jsonb,
  p_cursor        jsonb,
  p_applied_count bigint,
  p_state_hash    text,
  p_empty         boolean   -- true when no canonical events remain
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exists boolean;
  v_ver    bigint;
BEGIN
  SELECT position_version INTO v_ver FROM wallet_beliefs
   WHERE wallet = p_wallet AND onchain_id = p_market FOR UPDATE;
  v_exists := FOUND;

  IF NOT v_exists THEN
    INSERT INTO wallet_beliefs (wallet, onchain_id, position_version) VALUES (p_wallet, p_market, 0)
    ON CONFLICT (wallet, onchain_id) DO NOTHING;
    SELECT position_version INTO v_ver FROM wallet_beliefs
     WHERE wallet = p_wallet AND onchain_id = p_market FOR UPDATE;
  END IF;

  UPDATE wallet_beliefs SET
    yes_shares        = COALESCE((p_state->>'yes_shares')::numeric, 0),
    no_shares         = COALESCE((p_state->>'no_shares')::numeric, 0),
    yes_cost          = COALESCE((p_state->>'yes_cost')::numeric, 0),
    no_cost           = COALESCE((p_state->>'no_cost')::numeric, 0),
    expressed_side    = COALESCE(p_state->>'expressed_side', 'INACTIVE'),
    directional_since = NULLIF(p_state->>'directional_since','')::timestamptz,
    first_backed_at   = NULLIF(p_state->>'first_backed_at','')::timestamptz,
    last_trade_at     = NULLIF(p_state->>'last_trade_at','')::timestamptz,
    stance            = CASE WHEN p_state ? 'stance' THEN NULLIF(p_state->>'stance','')::numeric ELSE stance END,
    stance_side       = CASE WHEN p_state ? 'stance_side' THEN NULLIF(p_state->>'stance_side','') ELSE stance_side END,
    conviction        = CASE WHEN p_state ? 'conviction' THEN NULLIF(p_state->>'conviction','')::numeric ELSE conviction END,
    days_held         = CASE WHEN p_state ? 'days_held' THEN NULLIF(p_state->>'days_held','')::numeric ELSE days_held END,
    last_evaluated_at = CASE WHEN p_state ? 'last_evaluated_at' THEN NULLIF(p_state->>'last_evaluated_at','')::timestamptz ELSE last_evaluated_at END,
    last_applied_event_id     = NULLIF(p_cursor->>'event_id','')::uuid,
    last_applied_source_key   = NULLIF(p_cursor->>'source_key',''),
    last_applied_block_number = NULLIF(p_cursor->>'block_number','')::bigint,
    last_applied_log_index    = NULLIF(p_cursor->>'log_index','')::integer,
    position_version          = COALESCE(v_ver, 0) + 1,
    applied_trade_count       = p_applied_count,
    needs_rebuild             = false,
    rebuild_reason            = NULL,
    rebuild_requested_at      = NULL,
    rebuilt_at                = now(),
    state_hash                = p_state_hash,
    updated_at                = now()
  WHERE wallet = p_wallet AND onchain_id = p_market;

  RETURN jsonb_build_object('ok', true, 'empty', p_empty,
                            'new_version', COALESCE(v_ver, 0) + 1);
END;
$$;

-- ── mark_positions_dirty — enqueue pairs for the targeted rebuilder ───────────
-- Idempotent: sets the flag + reason once; keeps the earliest request time.
CREATE OR REPLACE FUNCTION public.mark_positions_dirty(p_pairs jsonb, p_reason text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_n integer := 0;
BEGIN
  WITH pairs AS (
    SELECT (e->>0) AS wallet, (e->>1)::bigint AS market
    FROM jsonb_array_elements(COALESCE(p_pairs,'[]'::jsonb)) e
  ),
  ins AS (
    INSERT INTO wallet_beliefs (wallet, onchain_id, needs_rebuild, rebuild_reason, rebuild_requested_at)
    SELECT wallet, market, true, p_reason, now() FROM pairs
    ON CONFLICT (wallet, onchain_id) DO UPDATE
      SET needs_rebuild = true,
          rebuild_reason = COALESCE(wallet_beliefs.rebuild_reason, EXCLUDED.rebuild_reason),
          rebuild_requested_at = COALESCE(wallet_beliefs.rebuild_requested_at, EXCLUDED.rebuild_requested_at)
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM ins;
  RETURN v_n;
END;
$$;

-- Only trusted server code may drive position state.
DO $$
DECLARE fn text;
BEGIN
  FOR fn IN SELECT unnest(ARRAY[
    'apply_position_events(text, bigint, bigint, jsonb, jsonb, bigint, text)',
    'rebuild_position(text, bigint, jsonb, jsonb, bigint, text, boolean)',
    'mark_positions_dirty(jsonb, text)'
  ]) LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM public', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;
END $$;


-- ── ingest_chain_chunk: also return orphan_pairs (reorg-affected pairs) ───────
-- Phase 3 needs the reorg-orphaned pairs separately so the poller can mark those
-- positions needs_rebuild with reason 'reorg'. Body is otherwise identical to the
-- Phase 2.5 definition (still stamps trades.event_source_key provenance).
CREATE OR REPLACE FUNCTION public.ingest_chain_chunk(
  p_events        jsonb,
  p_present_keys  jsonb,
  p_chain_id      bigint,
  p_start         bigint,
  p_end           bigint
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted  int := 0;
  v_replayed  int := 0;
  v_restored  int := 0;
  v_orphaned  int := 0;
  v_proj_ins  int := 0;
  v_proj_rem  int := 0;
  v_incoming_pairs jsonb := '[]'::jsonb;
  v_orphan_pairs   jsonb := '[]'::jsonb;
  v_pairs     jsonb := '[]'::jsonb;
BEGIN
  CREATE TEMP TABLE _inc ON COMMIT DROP AS
  SELECT
    (e->>'source_key')                 AS source_key,
    (e->>'source')                     AS source,
    (e->>'kind')                       AS kind,
    (e->>'market_id')                  AS market_id,
    (e->>'wallet')                     AS wallet,
    (e->>'side')                       AS side,
    (e->>'action')                     AS action,
    NULLIF(e->>'amount_eth','')::numeric      AS amount_eth,
    NULLIF(e->>'shares','')::numeric          AS shares,
    NULLIF(e->>'price','')::numeric           AS price,
    NULLIF(e->>'chain_id','')::bigint         AS chain_id,
    NULLIF(e->>'block_number','')::bigint     AS block_number,
    (e->>'block_hash')                 AS block_hash,
    (e->>'tx_hash')                    AS tx_hash,
    NULLIF(e->>'log_index','')::int           AS log_index,
    (e->>'occurred_at')::timestamptz          AS occurred_at,
    COALESCE(e->'payload','{}'::jsonb)        AS payload
  FROM jsonb_array_elements(COALESCE(p_events,'[]'::jsonb)) AS e;

  SELECT count(*) INTO v_inserted
  FROM _inc i
  WHERE NOT EXISTS (SELECT 1 FROM events ev WHERE ev.source_key = i.source_key);

  SELECT count(*) INTO v_restored
  FROM _inc i JOIN events ev ON ev.source_key = i.source_key
  WHERE ev.is_canonical = false;

  SELECT count(*) INTO v_replayed
  FROM _inc i JOIN events ev ON ev.source_key = i.source_key
  WHERE ev.is_canonical = true;

  INSERT INTO events (
    source_key, source, kind, market_id, wallet, side, action,
    amount_eth, shares, price, chain_id, block_number, block_hash,
    tx_hash, log_index, occurred_at, payload, is_canonical, orphaned_at
  )
  SELECT
    source_key, source, kind, market_id, wallet, side, action,
    amount_eth, shares, price, chain_id, block_number, block_hash,
    tx_hash, log_index, occurred_at, payload, true, NULL
  FROM _inc
  ON CONFLICT (source_key) DO UPDATE
    SET is_canonical = true, orphaned_at = NULL;

  -- Projection now carries event_source_key provenance.
  WITH proj AS (
    INSERT INTO trades (
      tx_hash, log_index, onchain_id, wallet, side, direction,
      eth_amount, token_amount, block_number, block_hash, raw_log, occurred_at,
      event_source_key
    )
    SELECT
      tx_hash, log_index, market_id::bigint, wallet, side, action,
      amount_eth, shares, block_number, block_hash, payload->'raw_log', occurred_at,
      source_key
    FROM _inc
    WHERE kind = 'trade'
    ON CONFLICT (tx_hash, log_index) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_proj_ins FROM proj;

  SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_array(wallet, market_id)), '[]'::jsonb)
  INTO v_incoming_pairs
  FROM _inc WHERE kind = 'trade';

  WITH orphans AS (
    UPDATE events ev
    SET is_canonical = false, orphaned_at = now()
    WHERE ev.source = 'chain'
      AND ev.kind = 'trade'
      AND ev.chain_id = p_chain_id
      AND ev.block_number BETWEEN p_start AND p_end
      AND ev.is_canonical = true
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(COALESCE(p_present_keys,'[]'::jsonb)) k
        WHERE k = ev.source_key
      )
    RETURNING ev.tx_hash, ev.log_index, ev.wallet, ev.market_id
  ),
  del AS (
    DELETE FROM trades t USING orphans o
    WHERE t.tx_hash = o.tx_hash AND t.log_index = o.log_index
    RETURNING 1
  )
  SELECT
    (SELECT count(*) FROM orphans),
    (SELECT count(*) FROM del),
    (SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_array(wallet, market_id)), '[]'::jsonb)
       FROM orphans)
  INTO v_orphaned, v_proj_rem, v_orphan_pairs;

  SELECT COALESCE(jsonb_agg(DISTINCT elem), '[]'::jsonb)
  INTO v_pairs
  FROM (
    SELECT elem FROM jsonb_array_elements(v_incoming_pairs) elem
    UNION
    SELECT elem FROM jsonb_array_elements(v_orphan_pairs) elem
  ) u;

  RETURN jsonb_build_object(
    'events_inserted', v_inserted,
    'events_replayed', v_replayed,
    'events_restored', v_restored,
    'events_orphaned', v_orphaned,
    'trade_projections_inserted', v_proj_ins,
    'trade_projections_removed', v_proj_rem,
    'pairs', v_pairs,
    'orphan_pairs', v_orphan_pairs
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ingest_chain_chunk(jsonb, jsonb, bigint, bigint, bigint) FROM public;
GRANT EXECUTE ON FUNCTION public.ingest_chain_chunk(jsonb, jsonb, bigint, bigint, bigint) TO service_role;
