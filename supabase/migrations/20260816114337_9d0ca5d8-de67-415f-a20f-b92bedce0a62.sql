UPDATE public.pi_setpoint
SET target_temp = NULL
WHERE commanded_at IS NULL AND target_temp IS NOT NULL;