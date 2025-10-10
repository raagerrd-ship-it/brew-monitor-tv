-- Fix search_path for the trigger_brew_sync function
CREATE OR REPLACE FUNCTION public.trigger_brew_sync()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  last_sync_time timestamp with time zone;
  sync_interval_seconds integer;
  time_since_last_sync interval;
  should_sync boolean := false;
BEGIN
  -- Get sync settings
  SELECT 
    last_sync_at,
    sync_interval
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
    UPDATE sync_settings SET last_sync_at = now();
    
    PERFORM net.http_post(
      url := 'https://plwchuzidrjgyuepwdcl.supabase.co/functions/v1/sync-brew-data',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBsd2NodXppZHJqZ3l1ZXB3ZGNsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk0ODUyOTIsImV4cCI6MjA3NTA2MTI5Mn0.p9giTnFOK-b0NqrB4ZqN-3CJEaAqMNy-KYvRZ6P_qS0"}'::jsonb,
      body := '{}'::jsonb
    );
  END IF;
END;
$$;