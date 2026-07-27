-- Phase 2 — one canonical immutable event log.
--
-- STORE FACTS, NOT STORIES. Before this migration a single chain trade was
-- recorded up to three times: a `trades` row, a `feed_events` row, and derived
-- story copy in application code. `events` becomes the single source of truth
-- for "what actually happened", keyed by a DETERMINISTIC source_key so the same
-- real-world action always resolves to the same row.
--
--   events = canonical source of truth
--   trades = TEMPORARY compatibility projection (position reducer + rollup only)
--
-- `trades` and `feed_events` are NOT deleted in this phase. No new feature may be
-- built on `trades`; only the ingestion path maintains it.

CREATE TABLE public.events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Deterministic identity of the real-world action (NEVER a random/ingest id).
  source_key     text NOT NULL UNIQUE,
  source         text NOT NULL,        -- chain | pov | system | legacy
  kind           text NOT NULL,        -- trade | market_created | legacy_event | (future)

  market_id      text,
  wallet         text,

  side           text,                 -- YES | NO   (trade)
  action         text,                 -- BUY | SELL (trade)

  -- Structured trade facts. amount_eth/shares carry RAW WEI (numeric) to mirror
  -- the trades projection losslessly; the UI converts. Primary trade fields live
  -- here as first-class columns, NOT hidden inside payload.
  amount_eth     numeric,
  shares         numeric,
  price          numeric,

  chain_id       bigint,
  block_number   bigint,
  block_hash     text,
  tx_hash        text,
  log_index      integer,

  -- occurred_at = canonical event time (block time for chain). NEVER created_at.
  occurred_at    timestamptz NOT NULL,
  ingested_at    timestamptz NOT NULL DEFAULT now(),

  -- Reorg auditability: an orphaned event is retained but excluded from product
  -- reads. It can become canonical again idempotently via its source_key.
  is_canonical   boolean NOT NULL DEFAULT true,
  orphaned_at    timestamptz,

  -- Source-specific fields that don't deserve first-class columns (e.g. raw_log,
  -- timestamp provenance). Never store viewer relevance / scores / feed copy here.
  payload        jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Reverse-chronological global feed (canonical only), with deterministic
-- tie-breakers block DESC, log DESC, id.
CREATE INDEX events_recency_idx
  ON public.events (occurred_at DESC, block_number DESC, log_index DESC, id)
  WHERE is_canonical = true;
-- Per-market and per-wallet activity (canonical only).
CREATE INDEX events_market_idx
  ON public.events (market_id, occurred_at DESC)
  WHERE is_canonical = true;
CREATE INDEX events_wallet_idx
  ON public.events (wallet, occurred_at DESC)
  WHERE is_canonical = true;
-- Chain reconciliation / reorg scan by canonical chain order.
CREATE INDEX events_chain_recon_idx
  ON public.events (chain_id, block_number, log_index);
-- Backfill / parity: chain trade events still missing a block time.
CREATE INDEX events_kind_source_idx
  ON public.events (source, kind);

-- Reads are public (matching every other table here); WRITES are service-role
-- only. anon/authenticated get no INSERT/UPDATE/DELETE grant, so RLS + the
-- absent grant together stop the public client from inserting events, editing
-- canonical fields, marking events orphaned, or changing occurrence/identity.
GRANT SELECT ON public.events TO anon, authenticated;
GRANT ALL ON public.events TO service_role;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
CREATE POLICY events_public_read ON public.events FOR SELECT TO anon, authenticated USING (true);
-- Live tape parity with feed_events.
ALTER PUBLICATION supabase_realtime ADD TABLE public.events;

-- ============================================================================
-- ingest_chain_chunk — the ATOMIC chain ingest primitive.
--
-- In ONE transaction it (1) inserts/reconciles canonical chain trade events,
-- (2) maintains the temporary `trades` projection, (3) marks reorg-orphaned
-- events non-canonical and removes their projections, and (4) returns the
-- affected (wallet, market_id) pairs so the caller can re-fold wallet_beliefs.
--
-- The application can therefore never durably insert an event while silently
-- failing to maintain its compatibility trade row — they commit together.
--
-- Replay safety: on conflict we touch ONLY is_canonical/orphaned_at (a restore).
-- occurred_at, ingested_at, amounts and block fields are left untouched, so an
-- unchanged replay is a no-op and never looks like new activity.
-- ============================================================================
-- p_present_keys is the FULL set of canonical source_keys Base returned for the
-- range (including any log we could not timestamp this pass). Orphaning is
-- computed against it, so a transient block-time fetch failure never wrongly
-- marks a still-canonical trade non-canonical or deletes its projection.
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
  -- Normalized incoming rows. ->> then ::type keeps wei exact (sent as strings).
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

  -- Classify against pre-existing state BEFORE the upsert writes.
  SELECT count(*) INTO v_inserted
  FROM _inc i
  WHERE NOT EXISTS (SELECT 1 FROM events ev WHERE ev.source_key = i.source_key);

  SELECT count(*) INTO v_restored
  FROM _inc i JOIN events ev ON ev.source_key = i.source_key
  WHERE ev.is_canonical = false;

  SELECT count(*) INTO v_replayed
  FROM _inc i JOIN events ev ON ev.source_key = i.source_key
  WHERE ev.is_canonical = true;

  -- (1) Upsert canonical events. On conflict: restore canonicity only.
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

  -- (2) Maintain the trades projection for kind='trade'. DO NOTHING on conflict
  --     preserves the existing projection (and its ingested_at) on replay;
  --     restored events whose projection was deleted are re-inserted here.
  WITH proj AS (
    INSERT INTO trades (
      tx_hash, log_index, onchain_id, wallet, side, direction,
      eth_amount, token_amount, block_number, block_hash, raw_log, occurred_at
    )
    SELECT
      tx_hash, log_index, market_id::bigint, wallet, side, action,
      amount_eth, shares, block_number, block_hash, payload->'raw_log', occurred_at
    FROM _inc
    WHERE kind = 'trade'
    ON CONFLICT (tx_hash, log_index) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_proj_ins FROM proj;

  -- Incoming trade pairs (affected → re-fold beliefs).
  SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_array(wallet, market_id)), '[]'::jsonb)
  INTO v_incoming_pairs
  FROM _inc WHERE kind = 'trade';

  -- (3) Orphan canonical chain trade events in [start,end] the rescan dropped;
  --     remove their projections; collect their pairs — one atomic statement.
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

  -- (4) Union incoming + orphan pairs, deduped.
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

-- ============================================================================
-- events_health — diagnostic parity query kept in the repo (see also
-- scripts/events-parity.sql). Returns a single jsonb row of health counters.
-- ============================================================================
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
