DELETE FROM public.house_predictions
WHERE actual_action IS NULL
  AND predicted_action IS NULL
  AND no_read_kind IS DISTINCT FROM 'no_user';