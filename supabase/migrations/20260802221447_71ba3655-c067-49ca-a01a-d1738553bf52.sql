UPDATE public.controller_learned_compensation
SET accumulated_integral = 0,
    latest_i_correction = 0,
    sensor_anchor = jsonb_set(COALESCE(sensor_anchor,'{}'::jsonb), '{lastDutyPct}', '5'::jsonb, true)
WHERE controller_id = 'ffa62be4-d6f7-4533-83b4-57ad93c3ac01'
  AND mode = 'cooling';