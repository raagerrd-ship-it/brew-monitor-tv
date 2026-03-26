
ALTER TABLE rapt_temp_controllers ADD COLUMN dual_sensor_enabled BOOLEAN DEFAULT false;
ALTER TABLE rapt_temp_controllers ADD COLUMN actual_temp NUMERIC;

-- Migrate: enable dual sensor for controllers that have a linked pill and global pill_compensation is on
UPDATE rapt_temp_controllers SET dual_sensor_enabled = true
WHERE linked_pill_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM auto_cooling_settings WHERE pill_compensation_enabled = true LIMIT 1);
