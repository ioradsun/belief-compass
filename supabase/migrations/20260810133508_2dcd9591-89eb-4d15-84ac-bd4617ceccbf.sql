CREATE OR REPLACE FUNCTION public.enqueue_stale_markets(p_limit integer DEFAULT 200, p_active_days integer DEFAULT 7)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids bigint[];
BEGIN
  -- A market qualifies when it traded recently (its windows are moving) OR when
  -- its read model is simply old. The second arm matters: a market that goes
  -- quiet used to be frozen forever at whatever the writer computed on its last
  -- active day, so later corrections to the writer never reached it and a held
  -- position could read as 0 participants / $0 capital.
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
       OR ms.calculated_at < now() - interval '6 hours'
    ORDER BY ms.calculated_at ASC NULLS FIRST, ms.events_updated_at ASC NULLS FIRST
    LIMIT p_limit
  ) t;

  IF v_ids IS NULL OR array_length(v_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  RETURN public.enqueue_market_refresh(v_ids, 'activity');
END;
$$;

-- Backfill: queue everything currently out of date so the corrected writer runs.
SELECT public.enqueue_market_refresh(
  (SELECT array_agg(onchain_id) FROM public.market_state
   WHERE calculated_at IS NULL OR calculated_at < now() - interval '6 hours'),
  'activity'
);