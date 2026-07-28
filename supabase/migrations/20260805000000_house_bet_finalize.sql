-- ============================================================================
-- House Read — bet-to-reveal finalize (additive).
--
-- The House pick now unlocks only when the viewer places a REAL on-chain bet
-- (a confirmed buy), verified server-side against the tx. A skip finalizes the
-- round but keeps the directional pick sealed. This adds the columns needed to
-- record the verified bet and to enforce one finalize per tx. Purely additive —
-- existing rows and the (wallet, onchain_id) primary key are untouched.
-- ============================================================================
ALTER TABLE public.house_predictions
  ADD COLUMN IF NOT EXISTS actual_tx_hash    text,
  ADD COLUMN IF NOT EXISTS actual_side       text CHECK (actual_side IN ('YES','NO')),
  ADD COLUMN IF NOT EXISTS actual_shares     numeric,
  ADD COLUMN IF NOT EXISTS actual_amount_wei numeric,
  ADD COLUMN IF NOT EXISTS finalized_via     text CHECK (finalized_via IN ('bet','skip'));

-- One confirmed tx can finalize at most one prediction.
CREATE UNIQUE INDEX IF NOT EXISTS house_pred_tx_unique
  ON public.house_predictions (actual_tx_hash) WHERE actual_tx_hash IS NOT NULL;
