-- 1. Fix mutable search_path on the only remaining function without one.
CREATE OR REPLACE FUNCTION public.market_price_path(p_ids bigint[], p_hours integer DEFAULT 72)
 RETURNS TABLE(onchain_id bigint, captured_at timestamp with time zone, yes_price_usd numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT DISTINCT ON (s.onchain_id, date_trunc('hour', s.captured_at))
         s.onchain_id, s.captured_at, s.yes_price_usd
  FROM public.price_snapshots s
  WHERE s.onchain_id = ANY(p_ids)
    AND s.captured_at >= now() - make_interval(hours => p_hours)
    AND s.yes_price_usd IS NOT NULL
  ORDER BY s.onchain_id, date_trunc('hour', s.captured_at), s.captured_at DESC;
$function$;

-- 2. events: public/realtime read is limited to an explicit allowlist of feed kinds.
DROP POLICY IF EXISTS "Public can read canonical activity" ON public.events;
CREATE POLICY "Public can read canonical activity"
  ON public.events FOR SELECT
  TO anon, authenticated
  USING (
    is_canonical
    AND kind IN (
      'trade',
      'market_created',
      'market_transition',
      'position_became_directional',
      'position_became_inactive',
      'position_became_mixed',
      'position_changed_side',
      'conviction_cohort',
      'believer_milestone',
      'tribe_doubled'
    )
  );

-- 3. market_state_snapshots: scope the public read to the real client roles.
DROP POLICY IF EXISTS "market_state_snapshots_read" ON public.market_state_snapshots;
CREATE POLICY "market_state_snapshots_read"
  ON public.market_state_snapshots FOR SELECT
  TO anon, authenticated
  USING (true);

-- 4. wallet_beliefs has no SELECT policy and must not be broadcast.
ALTER PUBLICATION supabase_realtime DROP TABLE public.wallet_beliefs;