ALTER TABLE public.controller_learned_compensation
  ADD COLUMN IF NOT EXISTS sensor_anchor jsonb;