update public.controller_learned_compensation
set accumulated_integral = 0,
    latest_i_correction = 0,
    sensor_anchor = jsonb_set(sensor_anchor, '{trimI}', '0'::jsonb)
where controller_id = '618b29b0-fa02-4f27-a8f1-a215f44235b3'
  and step_type = 'v6' and mode = 'cooling';