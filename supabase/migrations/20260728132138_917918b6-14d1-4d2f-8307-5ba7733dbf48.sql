ALTER TABLE public.house_predictions
  ADD COLUMN IF NOT EXISTS actual_tx_hash    text,
  ADD COLUMN IF NOT EXISTS actual_side       text CHECK (actual_side IN ('YES','NO')),
  ADD COLUMN IF NOT EXISTS actual_shares     numeric,
  ADD COLUMN IF NOT EXISTS actual_amount_wei numeric,
  ADD COLUMN IF NOT EXISTS finalized_via     text CHECK (finalized_via IN ('bet','skip'));

CREATE UNIQUE INDEX IF NOT EXISTS house_pred_tx_unique
  ON public.house_predictions (actual_tx_hash) WHERE actual_tx_hash IS NOT NULL;