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
UPDATE public.house_predictions SET finalized_via    = 'pass' WHERE finalized_via    = 'skip';