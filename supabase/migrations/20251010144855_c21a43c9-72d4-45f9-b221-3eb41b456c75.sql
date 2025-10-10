-- Add full sync interval setting to sync_settings table
ALTER TABLE public.sync_settings 
ADD COLUMN full_sync_interval integer DEFAULT 86400; -- Default to 24 hours (in seconds)

COMMENT ON COLUMN public.sync_settings.full_sync_interval IS 'Interval in seconds for automatic full synchronization. 3600=hourly, 21600=6h, 43200=12h, 86400=24h';