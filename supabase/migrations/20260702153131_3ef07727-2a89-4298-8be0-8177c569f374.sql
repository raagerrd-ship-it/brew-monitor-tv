UPDATE controller_learned_compensation
SET sensor_anchor = jsonb_set(sensor_anchor, '{kiAdjCooling}', '1.0'::jsonb)
WHERE controller_id='ffa62be4-d6f7-4533-83b4-57ad93c3ac01'
  AND mode='cooling' AND step_type='hold';