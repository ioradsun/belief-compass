CREATE OR REPLACE FUNCTION public.enqueue_stale_markets(p_limit integer DEFAULT 200, p_active_days integer DEFAULT 7)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids bigint[];
BEGIN
  -- Two reasons to recompute: the market is trading (its windows are moving), or
  -- its read model has gone properly cold. The cold arm exists because a market
  -- that stops trading used to be frozen forever at its last active figures —
  -- a held position could read as 0 participants / $0 capital indefinitely.
  --
  -- The cold threshold must stay WELL above the sweep interval. At 6h it matched
  -- essentially every row on every pass, and re-enqueueing bumps requested_at, so
  -- the queue refilled faster than the worker drained and genuinely stale markets
  -- never reached the front. A day is cold; anything fresher is just idle.
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
       OR ms.calculated_at IS NULL
       OR ms.calculated_at < now() - interval '24 hours'
    ORDER BY ms.calculated_at ASC NULLS FIRST, ms.events_updated_at ASC NULLS FIRST
    LIMIT p_limit
  ) t;

  IF v_ids IS NULL OR array_length(v_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  RETURN public.enqueue_market_refresh(v_ids, 'activity');
END;
$$;

-- Drain the flood the 6h threshold created, then re-queue only the cold ones.
DELETE FROM public.market_refresh_queue;
SELECT public.enqueue_market_refresh(
  (SELECT array_agg(onchain_id) FROM public.market_state
   WHERE calculated_at IS NULL OR calculated_at < now() - interval '24 hours'),
  'activity'
);