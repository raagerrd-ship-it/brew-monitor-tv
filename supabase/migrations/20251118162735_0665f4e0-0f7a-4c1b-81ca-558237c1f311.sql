-- Add columns to store followed controller data in adjustment logs
ALTER TABLE auto_cooling_adjustments
ADD COLUMN followed_controller_id text,
ADD COLUMN followed_controller_name text,
ADD COLUMN followed_current_temp numeric,
ADD COLUMN followed_target_temp numeric,
ADD COLUMN followed_hysteresis numeric;