-- enqueue_stale_markets — let the Story Engine speak about quiet markets.
--
-- THE BUG THIS FIXES. Every caller of enqueue_market_refresh is activity-driven:
-- the chain poller, the POV poller, the position rebuilder, market creation, and
-- the failure re-enqueue. Nothing was time-driven. So during a lull the refresh
-- queue drained to empty, refreshDirtyBatch returned no results, the refresher
-- handed emitStoryEvents an empty id array, and emitStoryEvents returned 0 at its
-- first line. No holder milestones, no rise/fall stories — the tape simply stopped
-- having anything to say the moment trading paused.
--
-- It compounded: a market_state row that is never refreshed also never slides its
-- 24h windows, so new_believers_24h / *_capital_delta_24h / trade_count_24h kept
-- reporting whatever was true when the market was last touched. The story inputs
-- froze at the same instant the story evaluation stopped.
--
-- This is the same mistake the conviction-cohort emitter already calls out in
-- market-refresher.ts ("a duration milestone is driven by the CLOCK, not by
-- trading … which is exactly backwards"). That lesson was applied to cohorts and
-- never carried back one call earlier, to story events.
--
-- THE SHAPE OF THE FIX. Each cron tick, enqueue the handful of markets whose
-- events-derived state is oldest — bounded, so the sweep costs the same whether
-- the ecosystem holds 300 markets or 30,000.
--
-- Restricted to markets with real canonical activity in the recent window, and
-- deliberately measured from `events` rather than from market_state's own
-- trade_count columns: those columns are exactly what goes stale here, so trusting
-- them to decide what needs refreshing would be circular — a market would be
-- skipped because the counter that proves it active had itself gone cold.

-- Walks oldest-first; NULLS FIRST puts never-refreshed rows at the head.
CREATE INDEX IF NOT EXISTS market_state_events_updated_idx
  ON public.market_state (events_updated_at NULLS FIRST);

CREATE OR REPLACE FUNCTION public.enqueue_stale_markets(
  p_limit integer DEFAULT 25,
  p_active_days integer DEFAULT 30
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids bigint[];
BEGIN
  SELECT array_agg(t.onchain_id)
  INTO v_ids
  FROM (
    SELECT ms.onchain_id
    FROM public.market_state ms
    WHERE EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.market_id = ms.onchain_id::text
        AND e.is_canonical
        AND e.occurred_at >= now() - make_interval(days => p_active_days)
    )
    ORDER BY ms.events_updated_at ASC NULLS FIRST
    LIMIT p_limit
  ) t;

  IF v_ids IS NULL OR array_length(v_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  -- 'activity' is the right kind: it is the events-derived aggregates (the 24h
  -- windows and believer counts the Story Engine reads) that have gone stale.
  RETURN public.enqueue_market_refresh(v_ids, 'activity');
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_stale_markets(integer, integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_stale_markets(integer, integer) TO service_role;
