-- Reset steady-state duty for Blå (ffa62be4) - corrupted by wrong revert targets
UPDATE fermentation_learnings 
SET learned_value = 0, sample_count = 0, last_updated_at = now()
WHERE controller_id = 'ffa62be4-d6f7-4533-83b4-57ad93c3ac01' 
  AND parameter_name LIKE 'steady_state_duty%';

-- Reset cooler margin learning (Kylare 7e57bd3c) - based on corrupted demand data
UPDATE fermentation_learnings 
SET learned_value = 5.0, sample_count = 0, last_updated_at = now()
WHERE controller_id = '7e57bd3c-a1bf-4634-a39e-e2f60b23d429' 
  AND parameter_name LIKE 'cooler_margin%';

-- Reset thermal_rate_cooling for Blå
UPDATE fermentation_learnings 
SET learned_value = 0, sample_count = 0, last_updated_at = now()
WHERE controller_id = 'ffa62be4-d6f7-4533-83b4-57ad93c3ac01' 
  AND parameter_name = 'thermal_rate_cooling';

-- Reset PID integral (accumulated_integral) for Blå cooling
UPDATE controller_learned_compensation
SET accumulated_integral = 0, latest_i_correction = 0, latest_p_correction = 0, 
    convergence_count = 0, updated_at = now()
WHERE controller_id = 'ffa62be4-d6f7-4533-83b4-57ad93c3ac01' 
  AND mode = 'cooling';