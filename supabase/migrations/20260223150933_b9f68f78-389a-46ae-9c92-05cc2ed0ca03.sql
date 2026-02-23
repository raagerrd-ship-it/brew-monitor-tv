
-- Add step_type column for phase-aware learning
ALTER TABLE public.controller_learned_compensation
  ADD COLUMN step_type text NOT NULL DEFAULT 'unknown';

-- Add accumulated_integral for persistent I-term with anti-windup
ALTER TABLE public.controller_learned_compensation
  ADD COLUMN accumulated_integral numeric NOT NULL DEFAULT 0;

-- Update unique constraint to include step_type
ALTER TABLE public.controller_learned_compensation
  DROP CONSTRAINT controller_learned_compensation_controller_bucket_mode_key;

ALTER TABLE public.controller_learned_compensation
  ADD CONSTRAINT controller_learned_compensation_controller_bucket_mode_step_key
  UNIQUE (controller_id, delta_bucket, mode, step_type);
