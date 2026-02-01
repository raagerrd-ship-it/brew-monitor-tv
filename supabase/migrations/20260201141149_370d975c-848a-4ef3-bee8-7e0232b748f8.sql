-- Add description column to brew_readings
ALTER TABLE public.brew_readings 
ADD COLUMN description text;