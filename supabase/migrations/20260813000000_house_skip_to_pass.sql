-- SKIP → PASS rename for the House round.
--
-- The application renamed the third belief action from SKIP to PASS (and the
-- finalize reason from 'skip' to 'pass'). This migration brings house_predictions
-- in line WITHOUT a deploy-ordering hazard:
--
--   1. Widen the CHECK constraints so they accept BOTH the old and the new
--      tokens. This means the new code (writing PASS/pass) is valid even if it
--      ships before this migration, and the old code (writing SKIP/skip) stays
--      valid if it lingers after — no window where a write violates a constraint.
--   2. Backfill existing rows to the new tokens.
--
-- The application also reads tolerantly (it normalizes any lingering SKIP/skip),
-- so this migration is safe to run before, with, or after the code deploy. A
-- later migration can tighten the constraints to the new tokens only, once no
-- writer emits the old ones.

ALTER TABLE public.house_predictions
  DROP CONSTRAINT IF EXISTS house_predictions_predicted_action_check,
  DROP CONSTRAINT IF EXISTS house_predictions_actual_action_check,
  DROP CONSTRAINT IF EXISTS house_predictions_finalized_via_check;

ALTER TABLE public.house_predictions
  ADD CONSTRAINT house_predictions_predicted_action_check
    CHECK (predicted_action IN ('YES', 'NO', 'PASS', 'SKIP')),
  ADD CONSTRAINT house_predictions_actual_action_check
    CHECK (actual_action IN ('YES', 'NO', 'PASS', 'SKIP')),
  ADD CONSTRAINT house_predictions_finalized_via_check
    CHECK (finalized_via IN ('bet', 'pass', 'skip'));

UPDATE public.house_predictions SET predicted_action = 'PASS' WHERE predicted_action = 'SKIP';
UPDATE public.house_predictions SET actual_action    = 'PASS' WHERE actual_action    = 'SKIP';
UPDATE public.house_predictions SET finalized_via     = 'pass' WHERE finalized_via     = 'skip';
