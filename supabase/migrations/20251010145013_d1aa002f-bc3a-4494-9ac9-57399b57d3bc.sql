-- Add last_full_sync_at column to track when full sync was last run
ALTER TABLE public.sync_settings 
ADD COLUMN last_full_sync_at timestamp with time zone;

-- Create function to trigger full brew sync based on interval
CREATE OR REPLACE FUNCTION public.trigger_full_brew_sync()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  last_sync_time timestamp with time zone;
  sync_interval_seconds integer;
  time_since_last_sync interval;
  should_sync boolean := false;
BEGIN
  -- Get full sync settings
  SELECT 
    last_full_sync_at,
    full_sync_interval
  INTO 
    last_sync_time,
    sync_interval_seconds
  FROM sync_settings
  LIMIT 1;
  
  -- If no last sync time, sync now
  IF last_sync_time IS NULL THEN
    should_sync := true;
  ELSE
    -- Calculate time since last sync
    time_since_last_sync := now() - last_sync_time;
    
    -- Check if enough time has passed
    IF EXTRACT(EPOCH FROM time_since_last_sync) >= sync_interval_seconds THEN
      should_sync := true;
    END IF;
  END IF;
  
  -- If we should sync, update timestamp and call edge function
  IF should_sync THEN
    UPDATE sync_settings SET last_full_sync_at = now();
    
    PERFORM net.http_post(
      url := 'https://plwchuzidrjgyuepwdcl.supabase.co/functions/v1/full-sync-brew-data',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBsd2NodXppZHJqZ3l1ZXB3ZGNsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk0ODUyOTIsImV4cCI6MjA3NTA2MTI5Mn0.p9giTnFOK-b0NqrB4ZqN-3CJEaAqMNy-KYvRZ6P_qS0"}'::jsonb,
      body := '{}'::jsonb
    );
  END IF;
END;
$$;

-- Create cron job that runs every hour to check if full sync is needed
SELECT cron.schedule(
  'check-full-brew-sync',
  '0 * * * *', -- Every hour at minute 0
  $$
  SELECT public.trigger_full_brew_sync();
  $$
);