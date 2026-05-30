UPDATE public.fermentation_sessions
SET ramp_triggered_at = now(),
    step_start_temp = 20,
    ramp_start_sg = 1.0171
WHERE id = 'd81ac2fb-a6c1-4959-917a-4b2a54bdd0b2'
  AND ramp_triggered_at IS NULL;

INSERT INTO public.fermentation_step_log (session_id, step_index, action, details)
VALUES (
  'd81ac2fb-a6c1-4959-917a-4b2a54bdd0b2',
  1,
  'condition_met',
  '{"condition":"gradual_ramp_triggered","manual":true,"reason":"action_check_constraint_blocked_sustained_low_gate","base_temp":20,"temp_increase":2.5,"ramp_start_sg":1.0171}'::jsonb
);