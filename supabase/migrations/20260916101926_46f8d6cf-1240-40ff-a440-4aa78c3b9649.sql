INSERT INTO public.brew_data_snapshots (brew_id, recorded_at, sg, pill_temp, controller_temp, profile_target_temp, auto_target_temp, actual_temp, duty_pct, cooling_enabled)
SELECT '30ba1ab6-b1ac-479c-8510-44ba24d062f9'::uuid,
       bucket,
       NULL,
       NULL,
       round(avg(actual_temp)::numeric, 2),
       round(avg(coalesce(profile_target_temp, target_temp))::numeric, 2),
       round(avg(actual_temp)::numeric, 2),
       round(avg(actual_temp)::numeric, 2),
       round(avg(duty_pct)::numeric, 1),
       bool_or(pid_mode = 'cooling')
FROM (
  SELECT to_timestamp(floor(extract(epoch from recorded_at) / 180) * 180) AT TIME ZONE 'UTC' AS bucket,
         actual_temp, target_temp, profile_target_temp, duty_pct, pid_mode
  FROM public.temp_controller_history
  WHERE controller_id = '6fbbc7db'
    AND recorded_at > '2026-09-15 13:33:00+00'
    AND actual_temp IS NOT NULL
) h
GROUP BY bucket
ON CONFLICT (brew_id, recorded_at) DO NOTHING;