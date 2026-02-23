-- Add mode column (heating/cooling) to separate learned baselines
ALTER TABLE public.controller_learned_compensation
  ADD COLUMN mode text NOT NULL DEFAULT 'cooling';

-- Add latest PID state columns for UI visibility
ALTER TABLE public.controller_learned_compensation
  ADD COLUMN latest_p_correction numeric NOT NULL DEFAULT 0,
  ADD COLUMN latest_i_correction numeric NOT NULL DEFAULT 0,
  ADD COLUMN latest_d_damping numeric NOT NULL DEFAULT 1.0,
  ADD COLUMN latest_avg_error numeric NOT NULL DEFAULT 0;

-- Drop old unique constraint (controller_id, delta_bucket)
ALTER TABLE public.controller_learned_compensation
  DROP CONSTRAINT controller_learned_compensation_controller_id_delta_bucket_key;

-- Create new unique constraint including mode
ALTER TABLE public.controller_learned_compensation
  ADD CONSTRAINT controller_learned_compensation_controller_bucket_mode_key
  UNIQUE (controller_id, delta_bucket, mode);
