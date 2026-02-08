
-- Widen column type to support 0-255 range
ALTER TABLE public.sonos_settings ALTER COLUMN bg_brightness TYPE numeric USING bg_brightness;

-- Convert existing values from old multiplier (0.0-1.0) to new scale (0-255)
UPDATE public.sonos_settings SET bg_brightness = ROUND(bg_brightness * 255) WHERE bg_brightness <= 1;

-- Set new default
ALTER TABLE public.sonos_settings ALTER COLUMN bg_brightness SET DEFAULT 90;
