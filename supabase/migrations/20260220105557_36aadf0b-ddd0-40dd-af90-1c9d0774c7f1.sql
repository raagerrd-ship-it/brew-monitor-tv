
ALTER TABLE public.auto_cooling_settings 
  ADD COLUMN IF NOT EXISTS pill_compensation_emergency_threshold numeric NOT NULL DEFAULT 3.0,
  ADD COLUMN IF NOT EXISTS pill_compensation_min_scale numeric NOT NULL DEFAULT 0.15,
  ADD COLUMN IF NOT EXISTS pill_compensation_max_compensation numeric NOT NULL DEFAULT 5.0;
