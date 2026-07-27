-- ── Canonical immutable event log ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key     text NOT NULL UNIQUE,
  source         text NOT NULL,
  kind           text NOT NULL,
  market_id      text,
  wallet         text,
  side           text,
  action         text,
  amount_eth     numeric,
  shares         numeric,
  price          numeric,
  chain_id       bigint,
  block_number   bigint,
  block_hash     text,
  tx_hash        text,
  log_index      integer,
  occurred_at    timestamptz NOT NULL,
  ingested_at    timestamptz NOT NULL DEFAULT now(),
  is_canonical   boolean NOT NULL DEFAULT true,
  orphaned_at    timestamptz,
  payload        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS events_recency_idx
  ON public.events (occurred_at DESC, block_number DESC, log_index DESC, id)
  WHERE is_canonical = true;
CREATE INDEX IF NOT EXISTS events_market_idx
  ON public.events (market_id, occurred_at DESC)
  WHERE is_canonical = true;
CREATE INDEX IF NOT EXISTS events_wallet_idx
  ON public.events (wallet, occurred_at DESC)
  WHERE is_canonical = true;
CREATE INDEX IF NOT EXISTS events_chain_recon_idx
  ON public.events (chain_id, block_number, log_index);
CREATE INDEX IF NOT EXISTS events_kind_source_idx
  ON public.events (source, kind);

GRANT SELECT ON public.events TO anon, authenticated;
GRANT ALL ON public.events TO service_role;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS events_public_read ON public.events;
CREATE POLICY events_public_read ON public.events FOR SELECT TO anon, authenticated USING (true);
ALTER PUBLICATION supabase_realtime ADD TABLE public.events;

-- ── Backfill canonical events from the legacy trades projection ─────────────
-- occurred_at falls back to the ingestion timestamp for historical rows that
-- have no block time yet; the provenance is recorded in payload so a later
-- block-time backfill can correct them.
INSERT INTO public.events (
  source_key, source, kind, market_id, wallet, side, action,
  amount_eth, shares, chain_id, block_number, block_hash, tx_hash, log_index,
  occurred_at, payload, is_canonical
)
SELECT
  'chain:8453:' || lower(t.tx_hash) || ':' || t.log_index,
  'chain', 'trade',
  t.onchain_id::text,
  lower(t.wallet),
  t.side,
  t.direction,
  t.eth_amount,
  t.token_amount,
  8453,
  t.block_number,
  t.block_hash,
  lower(t.tx_hash),
  t.log_index,
  COALESCE(t.occurred_at, t.ts, now()),
  jsonb_build_object(
    'raw_log', t.raw_log,
    'time_source', CASE WHEN t.occurred_at IS NOT NULL THEN 'block' ELSE 'ingested' END
  ),
  true
FROM public.trades t
ON CONFLICT (source_key) DO NOTHING;

-- ── ingest_chain_chunk — atomic chain ingest (events only) ──────────────────
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
    RETURNING ev.wallet, ev.market_id
  )
  SELECT
    (SELECT count(*) FROM orphans),
    (SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_array(wallet, market_id)), '[]'::jsonb)
       FROM orphans)
  INTO v_orphaned, v_orphan_pairs;

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
    'pairs', v_pairs,
    'orphan_pairs', v_orphan_pairs
  );
END;
$$;
REVOKE ALL ON FUNCTION public.ingest_chain_chunk(jsonb, jsonb, bigint, bigint, bigint) FROM public;
GRANT EXECUTE ON FUNCTION public.ingest_chain_chunk(jsonb, jsonb, bigint, bigint, bigint) TO service_role;

-- ── events_health ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.events_health()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'canonical_chain_trade_events',
      (SELECT count(*) FROM events WHERE source='chain' AND kind='trade' AND is_canonical),
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

-- ── Volume window now reads canonical events ────────────────────────────────
CREATE OR REPLACE FUNCTION public.market_volume_window(p_ids bigint[], p_since timestamptz)
RETURNS TABLE(onchain_id bigint, side text, eth numeric, trade_count bigint)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT ev.market_id::bigint AS onchain_id, ev.side,
         SUM(ev.amount_eth) / 1e18 AS eth, COUNT(*)::bigint AS trade_count
  FROM events ev
  WHERE ev.is_canonical
    AND ev.kind = 'trade'
    AND ev.side IN ('YES','NO')
    AND ev.market_id = ANY (ARRAY(SELECT unnest(p_ids)::text))
    AND ev.occurred_at IS NOT NULL
    AND (p_since IS NULL OR ev.occurred_at >= p_since)
  GROUP BY ev.market_id, ev.side;
$$;
GRANT EXECUTE ON FUNCTION public.market_volume_window(bigint[], timestamptz)
  TO anon, authenticated, service_role;