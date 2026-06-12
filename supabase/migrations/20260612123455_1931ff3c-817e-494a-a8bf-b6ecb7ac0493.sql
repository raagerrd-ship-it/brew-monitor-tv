UPDATE public.fermentation_learnings fl
SET learned_value = 0, last_updated_at = now()
WHERE fl.parameter_name IN ('rapt_write_fail_streak','rapt_circuit_open_until_ms','rapt_circuit_probe_pending')
  AND fl.learned_value > 0
  AND NOT EXISTS (SELECT 1 FROM public.pending_rapt_retries pr WHERE pr.controller_id = fl.controller_id);