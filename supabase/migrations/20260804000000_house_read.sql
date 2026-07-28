-- ============================================================================
-- House Read V1 — "The crowd predicts the market. The House predicts you."
--
-- Three tables:
--   • house_predictions      — one LOCKED prediction per (wallet, chain, market,
--                              engine_version). The predicted side is a SECRET
--                              until the user finalizes + reveals, so this table
--                              is NOT anon-readable: only the service role (via
--                              server functions that redact) may read it. RLS is
--                              enabled with no anon/authenticated policy → the
--                              publishable key cannot select it at all.
--   • house_interactions     — neutral, per-market telemetry (timings, switches,
--                              amounts). No clinical interpretations. Never used
--                              to alter an already-locked prediction.
--   • house_foundation_answers — the five free cold-start choices, with the
--                              mapping version + per-dimension contributions so
--                              the mapping can be revised without losing raw data.
--
-- Extension points for a future Vault Points / prize system are present as
-- columns/uniqueness only; NO points, rewards, or giveaway logic exists here.
-- Not verifiable headless — server functions read/write these with chain checks.
-- ============================================================================

-- ── 1. house_predictions (secret until reveal) ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.house_predictions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet                 text NOT NULL,
  chain_id               bigint NOT NULL,
  onchain_id             bigint NOT NULL,
  engine_version         integer NOT NULL,

  -- the sealed call
  predicted_action       text NOT NULL CHECK (predicted_action IN ('BUY_YES','BUY_NO','SKIP')),
  probability_buy_yes    numeric NOT NULL,
  probability_buy_no     numeric NOT NULL,
  probability_skip       numeric NOT NULL,
  confidence             numeric NOT NULL,
  confidence_band        text NOT NULL,
  reasons                jsonb NOT NULL DEFAULT '[]'::jsonb,
  signal_snapshot        jsonb,
  category               text,
  prediction_locked_at   timestamptz NOT NULL DEFAULT now(),

  -- how the user actually moved (filled on finalize)
  actual_action          text CHECK (actual_action IN ('BUY_YES','BUY_NO','SKIP')),
  actual_side            text CHECK (actual_side IN ('YES','NO')),
  actual_tx_hash         text,
  actual_shares_received numeric,
  actual_amount_wei      numeric,
  actual_amount_usd      numeric,
  actual_finalized_at    timestamptz,

  -- resolution + reveal
  outcome                text CHECK (outcome IN ('HOUSE_HIT','USER_WIN','SURPRISE','CALLED_BLUFF','PENDING'))
                         NOT NULL DEFAULT 'PENDING',
  reveal_clicked_at      timestamptz,
  revealed_at            timestamptz,

  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT house_pred_unique UNIQUE (wallet, chain_id, onchain_id, engine_version)
);
-- One finalized tx can settle at most one prediction.
CREATE UNIQUE INDEX IF NOT EXISTS house_pred_tx_unique
  ON public.house_predictions (actual_tx_hash) WHERE actual_tx_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS house_pred_wallet_idx ON public.house_predictions (wallet);

-- Secret-by-default: service role only. RLS on, no anon/authenticated policy.
GRANT ALL ON public.house_predictions TO service_role;
ALTER TABLE public.house_predictions ENABLE ROW LEVEL SECURITY;

-- ── 2. house_interactions (neutral telemetry) ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.house_interactions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prediction_id         uuid REFERENCES public.house_predictions(id) ON DELETE CASCADE,
  wallet                text NOT NULL,
  chain_id              bigint NOT NULL,
  onchain_id            bigint NOT NULL,

  market_activated_at   timestamptz,
  prediction_locked_at  timestamptz,
  first_interaction_at  timestamptz,
  first_selected_side   text CHECK (first_selected_side IN ('YES','NO')),
  last_selected_side    text CHECK (last_selected_side IN ('YES','NO')),
  side_switch_count     integer NOT NULL DEFAULT 0,
  initial_amount_usd    numeric,
  final_amount_usd      numeric,
  amount_revision_count integer NOT NULL DEFAULT 0,
  skip_at               timestamptz,
  buy_submitted_at      timestamptz,
  buy_confirmed_at      timestamptz,
  reveal_clicked_at     timestamptz,
  interaction_source    text,
  session_id            text,

  -- derived neutral flags (no clinical interpretation)
  fast_skip             boolean,
  side_switch           boolean,
  long_deliberation     boolean,
  amount_concentration  boolean,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS house_inter_wallet_market_idx
  ON public.house_interactions (wallet, onchain_id);
GRANT ALL ON public.house_interactions TO service_role;
ALTER TABLE public.house_interactions ENABLE ROW LEVEL SECURITY;

-- ── 3. house_foundation_answers (cold-start training) ───────────────────────
CREATE TABLE IF NOT EXISTS public.house_foundation_answers (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet                 text NOT NULL,
  foundation_key         text NOT NULL,
  market_id              bigint,
  action                 text NOT NULL CHECK (action IN ('YES','NO','SKIP')),
  mapping_version        integer NOT NULL,
  dimension_contributions jsonb NOT NULL DEFAULT '{}'::jsonb,
  answered_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT house_found_unique UNIQUE (wallet, foundation_key)
);
CREATE INDEX IF NOT EXISTS house_found_wallet_idx ON public.house_foundation_answers (wallet);
GRANT ALL ON public.house_foundation_answers TO service_role;
ALTER TABLE public.house_foundation_answers ENABLE ROW LEVEL SECURITY;

-- keep updated_at honest on the mutable tables
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS house_pred_touch ON public.house_predictions;
CREATE TRIGGER house_pred_touch BEFORE UPDATE ON public.house_predictions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS house_inter_touch ON public.house_interactions;
CREATE TRIGGER house_inter_touch BEFORE UPDATE ON public.house_interactions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
