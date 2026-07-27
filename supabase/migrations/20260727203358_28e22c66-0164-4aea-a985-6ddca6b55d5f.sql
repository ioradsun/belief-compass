CREATE TABLE IF NOT EXISTS public.wallet_match_version (
  wallet     text PRIMARY KEY,
  version    bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.wallet_match_version TO anon, authenticated;
GRANT ALL ON public.wallet_match_version TO service_role;
ALTER TABLE public.wallet_match_version ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wmv_public_read ON public.wallet_match_version;
CREATE POLICY wmv_public_read ON public.wallet_match_version
  FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.viewer_dna_cache (
  viewer_wallet       text PRIMARY KEY,
  viewer_dna_version  bigint NOT NULL DEFAULT 0,
  engine_version      integer NOT NULL DEFAULT 1,
  twin_matches        jsonb NOT NULL DEFAULT '[]'::jsonb,
  tribe_matches       jsonb NOT NULL DEFAULT '[]'::jsonb,
  neutral_matches     jsonb NOT NULL DEFAULT '[]'::jsonb,
  opp_matches         jsonb NOT NULL DEFAULT '[]'::jsonb,
  inverse_matches     jsonb NOT NULL DEFAULT '[]'::jsonb,
  closest_matches     jsonb NOT NULL DEFAULT '[]'::jsonb,
  domain_matches      jsonb NOT NULL DEFAULT '{}'::jsonb,
  candidate_count     integer NOT NULL DEFAULT 0,
  scored_count        integer NOT NULL DEFAULT 0,
  calculated_at       timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL DEFAULT now(),
  last_error          text
);
GRANT SELECT ON public.viewer_dna_cache TO anon, authenticated;
GRANT ALL ON public.viewer_dna_cache TO service_role;
ALTER TABLE public.viewer_dna_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vdc_public_read ON public.viewer_dna_cache;
CREATE POLICY vdc_public_read ON public.viewer_dna_cache
  FOR SELECT TO anon, authenticated USING (true);

CREATE OR REPLACE FUNCTION public.bump_wallet_match_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w text;
  old_dir boolean := (TG_OP <> 'INSERT') AND (OLD.stance_side IN ('YES','NO'));
  new_dir boolean := (TG_OP <> 'DELETE') AND (NEW.stance_side IN ('YES','NO'));
  changed boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    changed := new_dir;
    w := NEW.wallet;
  ELSIF TG_OP = 'DELETE' THEN
    changed := old_dir;
    w := OLD.wallet;
  ELSE
    changed := (old_dir OR new_dir)
      AND (
        OLD.stance_side IS DISTINCT FROM NEW.stance_side
        OR (old_dir AND new_dir
            AND abs(COALESCE(NEW.conviction,0) - COALESCE(OLD.conviction,0)) >= 0.05)
      );
    w := NEW.wallet;
  END IF;

  IF changed THEN
    INSERT INTO public.wallet_match_version (wallet, version, updated_at)
    VALUES (lower(w), 1, now())
    ON CONFLICT (wallet)
      DO UPDATE SET version = public.wallet_match_version.version + 1, updated_at = now();
    UPDATE public.viewer_dna_cache SET expires_at = now() WHERE viewer_wallet = lower(w);
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS wallet_beliefs_match_version ON public.wallet_beliefs;
CREATE TRIGGER wallet_beliefs_match_version
  AFTER INSERT OR UPDATE OR DELETE ON public.wallet_beliefs
  FOR EACH ROW EXECUTE FUNCTION public.bump_wallet_match_version();

CREATE INDEX IF NOT EXISTS wb_dir_market_idx
  ON public.wallet_beliefs (onchain_id, wallet)
  INCLUDE (stance_side, conviction, last_trade_at)
  WHERE stance_side IN ('YES','NO');
CREATE INDEX IF NOT EXISTS wb_dir_wallet_idx
  ON public.wallet_beliefs (wallet, onchain_id)
  INCLUDE (stance_side, conviction)
  WHERE stance_side IN ('YES','NO');

CREATE OR REPLACE FUNCTION public.find_match_candidates(
  p_viewer         text,
  p_min_shared     int DEFAULT 5,
  p_max_candidates int DEFAULT 500
)
RETURNS TABLE (
  wallet                  text,
  shared_markets          int,
  same_side               int,
  opposite_side           int,
  weighted_evidence       numeric,
  last_shared_activity_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH viewer AS (
    SELECT onchain_id, stance_side, GREATEST(conviction, 0) AS conviction
    FROM public.wallet_beliefs
    WHERE wallet = lower(p_viewer) AND stance_side IN ('YES','NO')
  ),
  pop AS (
    SELECT wb.onchain_id, count(*)::numeric AS participants
    FROM public.wallet_beliefs wb
    JOIN viewer v ON v.onchain_id = wb.onchain_id
    WHERE wb.stance_side IN ('YES','NO')
    GROUP BY wb.onchain_id
  ),
  cand AS (
    SELECT
      wb.wallet,
      (wb.stance_side = v.stance_side) AS same,
      sqrt(v.conviction * GREATEST(wb.conviction, 0))
        * (1.0 / log(2.0, 2 + COALESCE(p.participants, 0))) AS ev,
      wb.last_trade_at
    FROM public.wallet_beliefs wb
    JOIN viewer v ON v.onchain_id = wb.onchain_id
    LEFT JOIN pop p ON p.onchain_id = wb.onchain_id
    WHERE wb.stance_side IN ('YES','NO')
      AND wb.wallet <> lower(p_viewer)
      AND NOT EXISTS (SELECT 1 FROM public.wallet_denylist d WHERE d.wallet = wb.wallet)
  )
  SELECT
    wallet,
    count(*)::int AS shared_markets,
    count(*) FILTER (WHERE same)::int AS same_side,
    count(*) FILTER (WHERE NOT same)::int AS opposite_side,
    sum(ev) AS weighted_evidence,
    max(last_trade_at) AS last_shared_activity_at
  FROM cand
  GROUP BY wallet
  HAVING count(*) >= p_min_shared
  ORDER BY sum(ev) DESC, count(*) DESC, wallet ASC
  LIMIT p_max_candidates
$$;
GRANT EXECUTE ON FUNCTION public.find_match_candidates(text, int, int)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.request_viewer_match_refresh(p_wallet text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.match_queue (wallet, enqueued_at, pending)
  VALUES (lower(p_wallet), now(), true)
  ON CONFLICT (wallet) DO UPDATE SET pending = true, enqueued_at = now();
$$;
GRANT EXECUTE ON FUNCTION public.request_viewer_match_refresh(text)
  TO anon, authenticated, service_role;

DROP TABLE IF EXISTS public.wallet_matches;