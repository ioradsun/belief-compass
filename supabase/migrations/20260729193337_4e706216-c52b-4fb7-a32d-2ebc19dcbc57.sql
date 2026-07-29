CREATE TABLE public.market_milestone (
  market_id  text NOT NULL,
  side       text NOT NULL,
  threshold  integer NOT NULL,
  reached_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (market_id, side, threshold)
);

GRANT SELECT ON public.market_milestone TO anon, authenticated;
GRANT ALL ON public.market_milestone TO service_role;
ALTER TABLE public.market_milestone ENABLE ROW LEVEL SECURITY;
CREATE POLICY market_milestone_public_read
  ON public.market_milestone FOR SELECT TO anon, authenticated USING (true);

INSERT INTO public.market_milestone (market_id, side, threshold, reached_at)
SELECT ms.onchain_id::text, s.side, r.rung, now()
FROM public.market_state ms
CROSS JOIN (VALUES ('YES'), ('NO')) AS s(side)
CROSS JOIN (VALUES (10), (25), (50), (100), (250), (500), (1000), (2500), (5000), (10000))
  AS r(rung)
WHERE (CASE WHEN s.side = 'YES' THEN ms.believers_yes ELSE ms.believers_no END) >= r.rung
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.detect_believer_milestones()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emitted int := 0;
BEGIN
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

  INSERT INTO public.market_milestone (market_id, side, threshold, reached_at)
  SELECT market_id, side, threshold, now() FROM _newly
  ON CONFLICT DO NOTHING;

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