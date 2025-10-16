-- Add quick sync timestamp for RAPT data
ALTER TABLE public.sync_settings 
ADD COLUMN last_rapt_quick_sync_at timestamp with time zone;