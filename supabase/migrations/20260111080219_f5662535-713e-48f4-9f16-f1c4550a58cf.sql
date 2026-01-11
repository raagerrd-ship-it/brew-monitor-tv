-- Add setting for auto-hiding archived brews
ALTER TABLE public.sync_settings 
ADD COLUMN IF NOT EXISTS auto_hide_archived boolean DEFAULT true;