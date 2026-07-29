-- Tribe doublings — a community event when a side doubles in a day.
--
-- With the per-side 24h intake now in the read model (new_believers_yes/no_24h),
-- we can honestly detect "the NO tribe doubled today": a side whose believers
-- grew by at least as many as were there yesterday. base ≈ current − gained
-- (today's new believers); a doubling is current ≥ 2 × base, i.e. gained ≥ base.
--
-- Guardrails against noise:
--   • base must be ≥ 5 — "2 → 4" is not a story worth a feed event.
--   • idempotent + rate-limited by a DATE-stamped source_key
--     (tribe_doubled:<market>:<side>:<YYYY-MM-DD>): a side can trigger at most
--     once per day, and re-running the detector never double-emits.
-- No baseline seed is needed (unlike threshold milestones): doubling is inherently
-- a "last 24h" signal, so first-run emissions are genuinely recent, not history.

CREATE OR REPLACE FUNCTION public.detect_tribe_doublings()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emitted int := 0;
BEGIN
  WITH cand AS (
    SELECT
      ms.onchain_id::text AS market_id,
      s.side,
      (CASE WHEN s.side = 'YES' THEN ms.believers_yes ELSE ms.believers_no END) AS cnt,
      (CASE WHEN s.side = 'YES' THEN ms.new_believers_yes_24h ELSE ms.new_believers_no_24h END)
        AS gained
    FROM public.market_state ms
    CROSS JOIN (VALUES ('YES'), ('NO')) AS s(side)
  ),
  doubled AS (
    SELECT market_id, side, cnt, gained
    FROM cand
    WHERE gained > 0
      AND (cnt - gained) >= 5       -- there was a real tribe to double
      AND cnt >= 2 * (cnt - gained) -- it (at least) doubled today
  ),
  ins AS (
    INSERT INTO public.events (source_key, source, kind, market_id, side, occurred_at, payload)
    SELECT
      'tribe_doubled:' || market_id || ':' || side || ':' || to_char(now(), 'YYYY-MM-DD'),
      'system',
      'tribe_doubled',
      market_id,
      side,
      now(),
      jsonb_build_object('count', cnt, 'gained', gained)
    FROM doubled
    ON CONFLICT (source_key) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_emitted FROM ins;

  RETURN v_emitted;
END;
$$;

REVOKE ALL ON FUNCTION public.detect_tribe_doublings() FROM public;
GRANT EXECUTE ON FUNCTION public.detect_tribe_doublings() TO service_role;
