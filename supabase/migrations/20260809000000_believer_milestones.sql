-- Believer milestones — real community events for the living feed.
--
-- When a side's believer count crosses a rung (10, 25, 50, 100, 250, 500, 1k,
-- 2.5k, 5k, 10k) we emit ONE canonical system event ("YES just passed 500
-- believers") into the existing `events` log, so it flows through the live feed's
-- community class with no new read path. Emission is idempotent by source_key
-- (milestone:<market>:<side>:<threshold>) — a milestone is celebrated exactly
-- once, ever, even across reruns or a count that dips and recovers.
--
-- A small ledger records which milestones have been reached. The migration SEEDS
-- the ledger with every rung already passed by today's counts WITHOUT emitting
-- feed events, so installing this does not retroactively flood the feed with the
-- entire back-history of every established market. Only crossings observed AFTER
-- install become feed events.

CREATE TABLE public.market_milestone (
  market_id  text NOT NULL,
  side       text NOT NULL,          -- YES | NO
  threshold  integer NOT NULL,       -- the rung reached (believer count)
  reached_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (market_id, side, threshold)
);

-- Reads are public (matching every other table here); writes are service-role
-- only via the SECURITY DEFINER detector below.
GRANT SELECT ON public.market_milestone TO anon, authenticated;
GRANT ALL ON public.market_milestone TO service_role;
ALTER TABLE public.market_milestone ENABLE ROW LEVEL SECURITY;
CREATE POLICY market_milestone_public_read
  ON public.market_milestone FOR SELECT TO anon, authenticated USING (true);

-- ── Baseline seed — everything already passed is recorded as reached, but NO
--    event is emitted. This is the anti-flood line: the feed's milestone history
--    starts empty and fills only with genuinely new crossings.
INSERT INTO public.market_milestone (market_id, side, threshold, reached_at)
SELECT ms.onchain_id::text, s.side, r.rung, now()
FROM public.market_state ms
CROSS JOIN (VALUES ('YES'), ('NO')) AS s(side)
CROSS JOIN (VALUES (10), (25), (50), (100), (250), (500), (1000), (2500), (5000), (10000))
  AS r(rung)
WHERE (CASE WHEN s.side = 'YES' THEN ms.believers_yes ELSE ms.believers_no END) >= r.rung
ON CONFLICT DO NOTHING;

-- ============================================================================
-- detect_believer_milestones — find rungs newly passed since the ledger last
-- saw them, record them, and emit one canonical feed event each. Cheap: scans
-- market_state (one row per market) against a 10-rung ladder. Idempotent and
-- concurrency-safe (unique source_key + PK both ON CONFLICT DO NOTHING).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.detect_believer_milestones()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emitted int := 0;
BEGIN
  -- Rungs passed by the current per-side count that the ledger has NOT recorded.
  CREATE TEMP TABLE _newly ON COMMIT DROP AS
  SELECT
    ms.onchain_id::text AS market_id,
    s.side              AS side,
    (CASE WHEN s.side = 'YES' THEN ms.believers_yes ELSE ms.believers_no END) AS cnt,
    r.rung              AS threshold
  FROM public.market_state ms
  CROSS JOIN (VALUES ('YES'), ('NO')) AS s(side)
  CROSS JOIN (VALUES (10), (25), (50), (100), (250), (500), (1000), (2500), (5000), (10000))
    AS r(rung)
  WHERE (CASE WHEN s.side = 'YES' THEN ms.believers_yes ELSE ms.believers_no END) >= r.rung
    AND NOT EXISTS (
      SELECT 1 FROM public.market_milestone mm
      WHERE mm.market_id = ms.onchain_id::text
        AND mm.side = s.side
        AND mm.threshold = r.rung
    );

  -- Record first, so a concurrent run can't emit the same milestone twice.
  INSERT INTO public.market_milestone (market_id, side, threshold, reached_at)
  SELECT market_id, side, threshold, now() FROM _newly
  ON CONFLICT DO NOTHING;

  -- One canonical system event per newly-reached milestone. `count` is stored so
  -- the copy can read the exact figure at emission time.
  WITH ins AS (
    INSERT INTO public.events (source_key, source, kind, market_id, side, occurred_at, payload)
    SELECT
      'milestone:' || market_id || ':' || side || ':' || threshold,
      'system',
      'believer_milestone',
      market_id,
      side,
      now(),
      jsonb_build_object('threshold', threshold, 'count', cnt)
    FROM _newly
    ON CONFLICT (source_key) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_emitted FROM ins;

  RETURN v_emitted;
END;
$$;

REVOKE ALL ON FUNCTION public.detect_believer_milestones() FROM public;
GRANT EXECUTE ON FUNCTION public.detect_believer_milestones() TO service_role;
