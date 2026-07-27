-- ============================================================================
-- Conviction DNA v1 — five-label viewer cache + conviction-aware invalidation.
--
-- Supersedes the Phase 8 viewer_match_cache with a richer, product-facing model:
--   twin / tribe / neutral / opp / inverse buckets + per-domain Circles.
-- wallet_match_version remains the canonical per-wallet DNA version clock; its
-- trigger now also fires on a MATERIAL conviction change (not only side flips).
--
-- Not verifiable headless — the compute path writes this table from TypeScript.
-- ============================================================================

-- ── 1. DNA version bumps on material conviction change too ───────────────────
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
        -- material conviction move while staying directional (0.05 default)
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

-- ── 2. Viewer-owned bounded DNA cache (one row per viewer) ───────────────────
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
CREATE POLICY vdc_public_read ON public.viewer_dna_cache
  FOR SELECT TO anon, authenticated USING (true);

-- ── 3. Anon-callable refresh enqueue (feed cache-miss, no service key) ────────
-- Re-point the existing enqueue helper at the DNA cache semantics (match_queue is
-- reused as the bounded viewer refresh queue, drained by the match-worker).
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

-- ── 4. Retire the Phase 8 cache (all readers migrated to viewer_dna_cache) ────
DROP TABLE IF EXISTS public.viewer_match_cache;
