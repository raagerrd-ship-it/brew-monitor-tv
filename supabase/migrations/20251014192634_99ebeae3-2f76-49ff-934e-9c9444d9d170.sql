-- Add last_rapt_sync_at column to sync_settings
ALTER TABLE public.sync_settings 
ADD COLUMN last_rapt_sync_at TIMESTAMP WITH TIME ZONE;