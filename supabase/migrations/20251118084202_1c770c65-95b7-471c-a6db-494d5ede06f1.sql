-- Add hysteresis columns to rapt_temp_controllers table
ALTER TABLE rapt_temp_controllers 
ADD COLUMN IF NOT EXISTS cooling_hysteresis numeric DEFAULT 0.2,
ADD COLUMN IF NOT EXISTS heating_hysteresis numeric DEFAULT 0.2;