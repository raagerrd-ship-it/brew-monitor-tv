UPDATE fermentation_learnings 
SET learned_value = 0, sample_count = 0, last_updated_at = now()
WHERE controller_id = '6fbbc7db-cc77-49c8-be48-4f07ebb6ff5d' 
AND parameter_name = 'steady_state_duty:heating:hot';