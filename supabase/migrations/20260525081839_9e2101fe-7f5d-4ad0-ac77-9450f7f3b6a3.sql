UPDATE public.fermentation_sessions
SET step_start_temp = 14,
    step_started_at = now(),
    ramp_triggered_at = NULL
WHERE id = 'bf94f5bd-4c6a-4648-82ee-b10fb4925ca6';