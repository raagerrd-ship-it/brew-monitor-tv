ALTER TABLE public.sonos_settings
  ADD COLUMN IF NOT EXISTS bg_saturation numeric NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS bg_top_gradient_opacity numeric NOT NULL DEFAULT 0.45,
  ADD COLUMN IF NOT EXISTS bg_top_gradient_height integer NOT NULL DEFAULT 85;