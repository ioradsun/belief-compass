-- events-parity.sql — canonical-event health / parity checks.
--
-- Run any time to verify `events` is consistent with the `trades` projection
-- and to see the event taxonomy in production. The same checks are available as
-- the events_health() function (service-role) used by scripts/backfill-events.ts.

-- 1. One-shot health snapshot (matches events_health()).
SELECT public.events_health();

-- 2. Canonical chain trade events WITHOUT a trades projection (should be 0).
SELECT count(*) AS chain_events_without_projection
FROM public.events ev
WHERE ev.source = 'chain' AND ev.kind = 'trade' AND ev.is_canonical
  AND NOT EXISTS (
    SELECT 1 FROM public.trades t
    WHERE t.tx_hash = ev.tx_hash AND t.log_index = ev.log_index
  );

-- 3. Trade projections WITHOUT a canonical event (should be 0 after backfill;
--    trades still missing a block time are excluded — they aren't mappable yet).
SELECT count(*) AS projections_without_canonical_event
FROM public.trades t
WHERE t.occurred_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.events ev
    WHERE ev.source = 'chain' AND ev.kind = 'trade' AND ev.is_canonical
      AND ev.tx_hash = t.tx_hash AND ev.log_index = t.log_index
  );

-- 4. Canonical trade events missing occurred_at (must be 0 — occurred_at is NOT NULL).
SELECT count(*) AS canonical_trade_events_missing_occurred_at
FROM public.events
WHERE kind = 'trade' AND is_canonical AND occurred_at IS NULL;

-- 5. Canonical event counts by source and kind.
SELECT source, kind, count(*) AS n
FROM public.events
WHERE is_canonical
GROUP BY source, kind
ORDER BY source, kind;

-- 6. Non-canonical (reorg-orphaned) events by block range — should be rare.
SELECT (block_number / 10000) * 10000 AS block_bucket, count(*) AS orphaned
FROM public.events
WHERE NOT is_canonical AND block_number IS NOT NULL
GROUP BY 1
ORDER BY 1;
