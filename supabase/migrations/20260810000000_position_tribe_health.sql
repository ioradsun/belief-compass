-- Position tribe-health — a per-side "new believers today" figure.
--
-- The left-rail position cards want to show quiet tribe health for the side the
-- viewer holds: "👥 247 believers · 👋 +12 today". The believer COUNT per side
-- already exists (market_state.believers_yes / believers_no). What's missing is a
-- per-side new-believers-24h delta — market_state only had the market-wide
-- new_believers_24h and a single dominant nb_side.
--
-- The transition-windows aggregate already splits YES/NO internally (to pick the
-- dominant nb_side); this exposes both counts as first-class read-model fields so
-- a card can show the honest number for whichever side the wallet is on. No new
-- scan — the same events pass already computes it.

ALTER TABLE public.market_state
  ADD COLUMN IF NOT EXISTS new_believers_yes_24h integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS new_believers_no_24h  integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.market_transition_windows(p_market bigint, p_now timestamptz)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $$
  WITH t AS (
    SELECT kind, occurred_at, payload->>'new_side' AS new_side
    FROM events
    WHERE market_id = p_market::text AND is_canonical = true AND source = 'system'
      AND kind IN ('position_became_directional','position_changed_side',
                   'position_became_mixed','position_became_inactive')
  )
  SELECT jsonb_build_object(
    'new_believers_1h',  count(*) FILTER (WHERE kind='position_became_directional' AND occurred_at >= p_now - interval '1 hour'),
    'new_believers_24h', count(*) FILTER (WHERE kind='position_became_directional' AND occurred_at >= p_now - interval '24 hours'),
    'new_believers_7d',  count(*) FILTER (WHERE kind='position_became_directional' AND occurred_at >= p_now - interval '7 days'),
    -- Per-side split of the 24h intake — the same events, counted by new_side.
    'new_believers_yes_24h', count(*) FILTER (WHERE kind='position_became_directional' AND new_side='YES' AND occurred_at >= p_now - interval '24 hours'),
    'new_believers_no_24h',  count(*) FILTER (WHERE kind='position_became_directional' AND new_side='NO'  AND occurred_at >= p_now - interval '24 hours'),
    'side_flips_24h',    count(*) FILTER (WHERE kind='position_changed_side' AND occurred_at >= p_now - interval '24 hours'),
    'last_position_change_at', max(occurred_at),
    'nb_side_24h', (
      SELECT CASE WHEN y >= n AND y > 0 THEN 'YES' WHEN n > 0 THEN 'NO' ELSE NULL END FROM (
        SELECT count(*) FILTER (WHERE new_side='YES') AS y, count(*) FILTER (WHERE new_side='NO') AS n
        FROM t WHERE kind='position_became_directional' AND occurred_at >= p_now - interval '24 hours'
      ) s
    )
  ) FROM t;
$$;
GRANT EXECUTE ON FUNCTION public.market_transition_windows(bigint, timestamptz) TO service_role;
