-- Add fermentation_start column to brew_readings for custom brews
ALTER TABLE public.brew_readings 
ADD COLUMN fermentation_start timestamp with time zone NULL;