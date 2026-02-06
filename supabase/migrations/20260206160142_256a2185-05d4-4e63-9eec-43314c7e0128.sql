
ALTER TABLE public.sonos_settings 
ADD COLUMN bg_blur integer NOT NULL DEFAULT 40,
ADD COLUMN bg_brightness numeric(3,2) NOT NULL DEFAULT 0.4;
