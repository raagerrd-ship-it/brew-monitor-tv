UPDATE public.rapt_temp_controllers SET actuation = 'pi' WHERE controller_id = '618b29b0-fa02-4f27-a8f1-a215f44235b3';

INSERT INTO public.pi_setpoint (controller_id, target_temp, mode_allowed, set_by)
VALUES ('618b29b0-fa02-4f27-a8f1-a215f44235b3', 13.0, 'both', 'cloud')
ON CONFLICT (controller_id) DO UPDATE SET target_temp = EXCLUDED.target_temp, set_by = 'cloud', set_at = now();