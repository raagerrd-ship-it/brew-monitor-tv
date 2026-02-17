
-- Add fermentation stall detection and auto-boost settings
ALTER TABLE public.auto_cooling_settings 
  ADD COLUMN auto_boost_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN auto_boost_degrees numeric NOT NULL DEFAULT 1.0,
  ADD COLUMN stall_rate_threshold numeric NOT NULL DEFAULT 0.001;
