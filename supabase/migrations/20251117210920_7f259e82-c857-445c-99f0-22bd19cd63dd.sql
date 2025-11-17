-- Add last_check_at column to track when auto cooling last checked
ALTER TABLE auto_cooling_settings 
ADD COLUMN last_check_at TIMESTAMP WITH TIME ZONE DEFAULT now();