INSERT INTO public.brew_data_snapshots (brew_id, recorded_at, actual_temp, pill_temp, controller_temp, profile_target_temp, duty_pct, cooling_enabled)
SELECT '30ba1ab6-b1ac-479c-8510-44ba24d062f9'::uuid,
       h.recorded_at,
       COALESCE(h.actual_temp, h.current_temp),
       NULL, NULL,
       COALESCE(h.profile_target_temp, h.target_temp),
       h.duty_pct,
       COALESCE(h.pid_mode = 'cooling', h.cooling_enabled)
FROM public.temp_controller_history h
WHERE h.controller_id LIKE '6fbbc7db%'
  AND h.recorded_at >= '2026-09-05 17:12:00+00'
  AND h.recorded_at < (SELECT MIN(recorded_at) FROM public.brew_data_snapshots WHERE brew_id = '30ba1ab6-b1ac-479c-8510-44ba24d062f9')
  AND COALESCE(h.actual_temp, h.current_temp) IS NOT NULL;