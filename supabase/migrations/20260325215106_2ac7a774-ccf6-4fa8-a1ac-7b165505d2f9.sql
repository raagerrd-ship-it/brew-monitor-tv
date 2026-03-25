UPDATE fermentation_learnings 
SET learned_value = 2, last_updated_at = now() 
WHERE controller_id = 'ffa62be4-d6f7-4533-83b4-57ad93c3ac01' 
AND parameter_name = 'pid_current_mode';

UPDATE fermentation_learnings 
SET learned_value = 0, last_updated_at = now() 
WHERE controller_id = 'ffa62be4-d6f7-4533-83b4-57ad93c3ac01' 
AND parameter_name = 'mode_switch_pressure';

UPDATE fermentation_learnings 
SET learned_value = 0, last_updated_at = now() 
WHERE controller_id = 'ffa62be4-d6f7-4533-83b4-57ad93c3ac01' 
AND parameter_name = 'pid_last_duty';