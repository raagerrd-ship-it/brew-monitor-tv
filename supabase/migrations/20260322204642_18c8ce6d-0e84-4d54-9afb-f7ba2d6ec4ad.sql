UPDATE controller_learned_compensation 
SET accumulated_integral = 0, 
    latest_i_correction = 0, 
    latest_p_correction = 0,
    latest_avg_error = 0,
    updated_at = now()
WHERE controller_id = 'ffa62be4-d6f7-4533-83b4-57ad93c3ac01' 
  AND delta_bucket = 'medium';