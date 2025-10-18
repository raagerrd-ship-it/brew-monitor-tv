-- Add min and max target temperature columns to rapt_temp_controllers
ALTER TABLE rapt_temp_controllers
ADD COLUMN min_target_temp numeric DEFAULT -5,
ADD COLUMN max_target_temp numeric DEFAULT 25;