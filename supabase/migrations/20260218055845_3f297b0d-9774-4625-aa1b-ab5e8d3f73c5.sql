ALTER TABLE public.auto_cooling_settings 
ADD COLUMN overshoot_prevention_enabled boolean NOT NULL DEFAULT true,
ADD COLUMN overshoot_pill_threshold numeric NOT NULL DEFAULT 0.3,
ADD COLUMN overshoot_delta_threshold numeric NOT NULL DEFAULT 2.0;