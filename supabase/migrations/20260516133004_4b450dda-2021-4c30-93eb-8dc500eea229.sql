UPDATE public.fermentation_learnings
SET learned_value = 3.0, sample_count = 1, last_updated_at = now()
WHERE controller_id = '7e57bd3c-a1bf-4634-a39e-e2f60b23d429'
  AND parameter_name IN ('hold_margin:warm:load_1', 'cooler_margin:warm', 'min_effective_margin:warm');