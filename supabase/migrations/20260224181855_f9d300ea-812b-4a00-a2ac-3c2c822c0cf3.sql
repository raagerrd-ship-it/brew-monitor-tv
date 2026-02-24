ALTER TABLE public.auto_cooling_settings
ADD COLUMN stall_min_attenuation numeric NOT NULL DEFAULT 10,
ADD COLUMN stall_max_attenuation numeric NOT NULL DEFAULT 90;