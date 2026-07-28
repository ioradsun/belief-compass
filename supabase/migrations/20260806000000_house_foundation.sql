-- ============================================================================
-- House Read — cold-start foundation answers.
--
-- A new (or thin-history) viewer trains the House with five FREE belief choices
-- on moderate, single-dimension POVs. We store the raw answer, the mapping
-- version, and the per-dimension contributions so the mapping can be revised
-- later without losing the original data. Service-role only; the pick logic and
-- progress are served through server functions. One answer per (wallet, POV).
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.house_foundation_answers (
  wallet                  text NOT NULL,
  foundation_key          text NOT NULL,
  action                  text NOT NULL CHECK (action IN ('YES','NO','SKIP')),
  mapping_version         integer NOT NULL,
  dimension_contributions jsonb NOT NULL DEFAULT '{}'::jsonb,
  answered_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (wallet, foundation_key)
);
CREATE INDEX IF NOT EXISTS house_foundation_wallet_idx
  ON public.house_foundation_answers (wallet);
GRANT ALL ON public.house_foundation_answers TO service_role;
ALTER TABLE public.house_foundation_answers ENABLE ROW LEVEL SECURITY;
