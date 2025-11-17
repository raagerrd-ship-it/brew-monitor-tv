-- Add cooler_controller_id to auto_cooling_settings
ALTER TABLE auto_cooling_settings 
ADD COLUMN cooler_controller_id TEXT;

-- Create table for tracking which controllers should be followed by the cooler
CREATE TABLE auto_cooling_followed_controllers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  controller_id TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(controller_id)
);

-- Enable RLS
ALTER TABLE auto_cooling_followed_controllers ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Anyone can view followed controllers"
  ON auto_cooling_followed_controllers FOR SELECT
  USING (true);

CREATE POLICY "Anyone can insert followed controllers"
  ON auto_cooling_followed_controllers FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can delete followed controllers"
  ON auto_cooling_followed_controllers FOR DELETE
  USING (true);