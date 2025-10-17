-- Add display_order column to selected_rapt_pills
ALTER TABLE selected_rapt_pills 
ADD COLUMN display_order integer NOT NULL DEFAULT 0;

-- Add display_order column to selected_rapt_temp_controllers
ALTER TABLE selected_rapt_temp_controllers 
ADD COLUMN display_order integer NOT NULL DEFAULT 0;

-- Set initial display_order values based on created_at
WITH ranked_pills AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at) as rn
  FROM selected_rapt_pills
)
UPDATE selected_rapt_pills
SET display_order = ranked_pills.rn
FROM ranked_pills
WHERE selected_rapt_pills.id = ranked_pills.id;

WITH ranked_controllers AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at) as rn
  FROM selected_rapt_temp_controllers
)
UPDATE selected_rapt_temp_controllers
SET display_order = ranked_controllers.rn
FROM ranked_controllers
WHERE selected_rapt_temp_controllers.id = ranked_controllers.id;