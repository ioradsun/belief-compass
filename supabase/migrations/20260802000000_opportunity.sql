-- Phase 5 — global opportunity engine output on market_state.
--
-- The pure evaluator (src/domain/opportunity.ts) classifies + scores each market
-- from canonical market_state facts ONLY (no viewer data). Its output is stored on
-- the same coherent market_state row by the refresher. One primary type per market.

ALTER TABLE public.market_state
  ADD COLUMN IF NOT EXISTS opportunity_type            text,
  ADD COLUMN IF NOT EXISTS opportunity_score           numeric,
  ADD COLUMN IF NOT EXISTS opportunity_score_raw       numeric,
  ADD COLUMN IF NOT EXISTS opportunity_reason_code     text,
  ADD COLUMN IF NOT EXISTS opportunity_reason          text,
  ADD COLUMN IF NOT EXISTS opportunity_window          text,
  ADD COLUMN IF NOT EXISTS opportunity_sample_size     integer,
  ADD COLUMN IF NOT EXISTS opportunity_confidence      text,
  ADD COLUMN IF NOT EXISTS opportunity_evidence        jsonb,
  ADD COLUMN IF NOT EXISTS opportunity_eligible        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS opportunity_ineligible_reason text,
  ADD COLUMN IF NOT EXISTS opportunity_calculated_at   timestamptz,
  ADD COLUMN IF NOT EXISTS opportunity_engine_version  integer NOT NULL DEFAULT 1,
  -- hysteresis / stability
  ADD COLUMN IF NOT EXISTS opportunity_type_since      timestamptz,
  ADD COLUMN IF NOT EXISTS opportunity_previous_type   text;

-- The center candidate query: eligible markets, ordered by score. Partial index
-- keeps it to the eligible set with deterministic tie-breakers.
CREATE INDEX IF NOT EXISTS ms_opportunity_feed_idx
  ON public.market_state (opportunity_score DESC, opportunity_calculated_at DESC, onchain_id)
  WHERE opportunity_eligible = true;
-- Filter-by-type (the dropdown) within the eligible set.
CREATE INDEX IF NOT EXISTS ms_opportunity_type_idx
  ON public.market_state (opportunity_type, opportunity_score DESC)
  WHERE opportunity_eligible = true;
