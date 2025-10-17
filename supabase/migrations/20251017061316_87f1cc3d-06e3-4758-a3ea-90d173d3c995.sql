-- Add cooling and heating status fields to rapt_temp_controllers
ALTER TABLE rapt_temp_controllers 
ADD COLUMN IF NOT EXISTS cooling_enabled boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS heating_enabled boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS heating_utilisation numeric DEFAULT 0;