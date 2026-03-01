-- Fix corrupted SG snapshots (18:45 and 19:00)
UPDATE brew_data_snapshots SET sg = 1.0107 
WHERE id IN ('34fbd196-52d0-4c85-bb24-49a1cd549560', '5017527a-a3ba-4544-9b15-fdaccb08af9d');

-- Fix sg_data history in brew_readings
UPDATE brew_readings SET 
  sg_data = (
    SELECT jsonb_agg(
      CASE 
        WHEN (elem->>'value')::numeric > 1.015 
          AND (elem->>'date')::timestamptz >= '2026-03-01T17:00:00Z'
        THEN jsonb_build_object('date', elem->>'date', 'value', 1.0107, 'temp', (elem->>'temp')::numeric)
        ELSE elem
      END
      ORDER BY (elem->>'date')::timestamptz
    ) FROM jsonb_array_elements(sg_data) AS elem
  ),
  current_sg = 1.0107
WHERE name = 'Falkens Flykt';

-- Reset the bad learned value so it starts fresh
UPDATE fermentation_learnings 
SET learned_value = 0, sample_count = 0 
WHERE parameter_name LIKE 'sg_residual_per_degree%';