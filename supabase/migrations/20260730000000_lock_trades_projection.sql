-- Phase 2.5 — eliminate duplicate active paths: lock the trades projection.
--
-- `trades` is now a TEMPORARY compatibility projection derived only from
-- canonical `events`. This migration:
--   1. gives every projected trade explicit provenance back to its canonical
--      event (event_source_key), 1:1 via chain_id/tx_hash/log_index;
--   2. locks writes so only the canonical ingest transaction (and service-role
--      maintenance) may maintain the projection;
--   3. teaches ingest_chain_chunk() to stamp the provenance on insert.
--
-- It does NOT delete trades, change position math, or add incremental updates.

-- ── 1. Provenance ────────────────────────────────────────────────────────────
ALTER TABLE public.trades
  ADD COLUMN IF NOT EXISTS event_source_key text;

-- Backfill provenance deterministically. The canonical chain key is
-- chain:{chain_id}:{tx_hash}:{log_index} (see src/lib/events.ts). Base = 8453,
-- matching src/chain/abi.meta.json / decoder CHAIN_ID. Hashes are lowercased.
-- This resolves through chain_id/tx_hash/log_index ONLY — never fuzzy joins.
UPDATE public.trades
SET event_source_key = 'chain:8453:' || lower(tx_hash) || ':' || log_index
WHERE event_source_key IS NULL;

-- One canonical event ↔ one projection row.
CREATE UNIQUE INDEX IF NOT EXISTS trades_event_source_key_uidx
  ON public.trades (event_source_key)
  WHERE event_source_key IS NOT NULL;

COMMENT ON TABLE public.trades IS
  'Temporary compatibility projection derived from canonical events. Do not write directly. '
  'Maintained only by ingest_chain_chunk() (canonical ingest) and documented service-role '
  'backfill/repair tooling. event_source_key traces each row to its canonical event.';
COMMENT ON COLUMN public.trades.event_source_key IS
  'Canonical events.source_key this projection row derives from (chain:{chain_id}:{tx_hash}:{log_index}).';

-- ── 2. Lock down direct writes ───────────────────────────────────────────────
-- Ordinary application roles may read the projection but never mutate it. (They
-- already lacked a write grant + RLS has no write policy; this is explicit.)
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.trades FROM anon, authenticated;

-- Defense-in-depth guard: reject a direct trade write from the public API roles.
-- SECURITY INVOKER (default) so current_user reflects the ACTUAL caller. It does
-- NOT fire for the canonical ingest (ingest_chain_chunk is SECURITY DEFINER, so
-- current_user is the function owner, not anon/authenticated) nor for service-role
-- maintenance — so it cannot recursively conflict with ingest. Lives in public so
-- every role can reach it; it only ever raises for anon/authenticated.
CREATE OR REPLACE FUNCTION public.reject_direct_trade_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION
      'trades is a compatibility projection derived from canonical events; direct writes are not allowed';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
GRANT EXECUTE ON FUNCTION public.reject_direct_trade_write() TO anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trades_no_direct_write ON public.trades;
CREATE TRIGGER trades_no_direct_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.trades
  FOR EACH ROW EXECUTE FUNCTION public.reject_direct_trade_write();

-- ── 3. ingest_chain_chunk stamps provenance ──────────────────────────────────
-- Identical to the Phase 2 function except the trades projection insert now also
-- writes event_source_key = the canonical event's source_key.
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
    'pairs', v_pairs
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ingest_chain_chunk(jsonb, jsonb, bigint, bigint, bigint) FROM public;
GRANT EXECUTE ON FUNCTION public.ingest_chain_chunk(jsonb, jsonb, bigint, bigint, bigint) TO service_role;

-- ── 4. Provenance parity in events_health() ──────────────────────────────────
-- Add a projection-provenance counter alongside the existing checks.
CREATE OR REPLACE FUNCTION public.events_health()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'canonical_trades', (SELECT count(*) FROM trades),
    'canonical_chain_trade_events',
      (SELECT count(*) FROM events WHERE source='chain' AND kind='trade' AND is_canonical),
    'chain_events_without_projection',
      (SELECT count(*) FROM events ev
        WHERE ev.source='chain' AND ev.kind='trade' AND ev.is_canonical
          AND NOT EXISTS (SELECT 1 FROM trades t
                          WHERE t.tx_hash=ev.tx_hash AND t.log_index=ev.log_index)),
    'projections_without_canonical_event',
      (SELECT count(*) FROM trades t
        WHERE NOT EXISTS (SELECT 1 FROM events ev
                          WHERE ev.source='chain' AND ev.kind='trade' AND ev.is_canonical
                            AND ev.tx_hash=t.tx_hash AND ev.log_index=t.log_index)),
    'projections_without_provenance',
      (SELECT count(*) FROM trades WHERE event_source_key IS NULL),
    'projections_with_mismatched_occurred_at',
      (SELECT count(*) FROM trades t JOIN events ev ON ev.source_key = t.event_source_key
        WHERE ev.is_canonical AND t.occurred_at IS DISTINCT FROM ev.occurred_at),
    'canonical_trade_events_missing_occurred_at',
      (SELECT count(*) FROM events WHERE kind='trade' AND is_canonical AND occurred_at IS NULL),
    'events_missing_market_id',
      (SELECT count(*) FROM events WHERE is_canonical AND market_id IS NULL),
    'events_missing_wallet',
      (SELECT count(*) FROM events WHERE is_canonical AND kind='trade' AND wallet IS NULL),
    'noncanonical_events', (SELECT count(*) FROM events WHERE NOT is_canonical),
    'counts_by_source_kind',
      (SELECT COALESCE(jsonb_object_agg(sk, n), '{}'::jsonb) FROM (
        SELECT source||'/'||kind AS sk, count(*) AS n
        FROM events WHERE is_canonical GROUP BY 1) s)
  );
$$;
GRANT EXECUTE ON FUNCTION public.events_health() TO service_role;
