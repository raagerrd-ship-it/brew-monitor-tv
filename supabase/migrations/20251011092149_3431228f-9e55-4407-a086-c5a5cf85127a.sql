-- Drop the old trigger_brew_sync function
DROP FUNCTION IF EXISTS public.trigger_brew_sync();

-- Create a new simpler trigger function that always syncs when called by cron
CREATE OR REPLACE FUNCTION public.trigger_brew_sync()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Update timestamp
  UPDATE sync_settings SET last_sync_at = now();
  
  -- Call edge function
  PERFORM net.http_post(
    url := 'https://plwchuzidrjgyuepwdcl.supabase.co/functions/v1/sync-brew-data',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBsd2NodXppZHJqZ3l1ZXB3ZGNsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk0ODUyOTIsImV4cCI6MjA3NTA2MTI5Mn0.p9giTnFOK-b0NqrB4ZqN-3CJEaAqMNy-KYvRZ6P_qS0"}'::jsonb,
    body := '{}'::jsonb
  );
END;
$$;

-- Create function to update cron schedule based on sync_interval
CREATE OR REPLACE FUNCTION public.update_sync_cron_schedule()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  cron_schedule text;
BEGIN
  -- Convert sync_interval (seconds) to cron schedule
  CASE NEW.sync_interval
    WHEN 60 THEN cron_schedule := '* * * * *';           -- Every minute at :00 seconds
    WHEN 300 THEN cron_schedule := '*/5 * * * *';        -- Every 5 minutes at :00 seconds
    WHEN 600 THEN cron_schedule := '*/10 * * * *';       -- Every 10 minutes at :00 seconds
    WHEN 900 THEN cron_schedule := '*/15 * * * *';       -- Every 15 minutes at :00 seconds
    WHEN 3600 THEN cron_schedule := '0 * * * *';         -- Every hour at :00:00
    ELSE cron_schedule := '* * * * *';                   -- Default to every minute
  END CASE;

  -- Update the cron job
  PERFORM cron.unschedule('brew-data-sync');
  PERFORM cron.schedule(
    'brew-data-sync',
    cron_schedule,
    'SELECT public.trigger_brew_sync();'
  );

  RETURN NEW;
END;
$$;

-- Create trigger to update cron schedule when sync_interval changes
DROP TRIGGER IF EXISTS update_sync_cron_trigger ON sync_settings;
CREATE TRIGGER update_sync_cron_trigger
AFTER UPDATE OF sync_interval ON sync_settings
FOR EACH ROW
WHEN (OLD.sync_interval IS DISTINCT FROM NEW.sync_interval)
EXECUTE FUNCTION update_sync_cron_schedule();

-- Initialize cron with current setting
DO $$
DECLARE
  current_interval integer;
  cron_schedule text;
BEGIN
  SELECT sync_interval INTO current_interval FROM sync_settings LIMIT 1;
  
  IF current_interval IS NOT NULL THEN
    CASE current_interval
      WHEN 60 THEN cron_schedule := '* * * * *';
      WHEN 300 THEN cron_schedule := '*/5 * * * *';
      WHEN 600 THEN cron_schedule := '*/10 * * * *';
      WHEN 900 THEN cron_schedule := '*/15 * * * *';
      WHEN 3600 THEN cron_schedule := '0 * * * *';
      ELSE cron_schedule := '* * * * *';
    END CASE;

    PERFORM cron.unschedule('brew-data-sync');
    PERFORM cron.schedule(
      'brew-data-sync',
      cron_schedule,
      'SELECT public.trigger_brew_sync();'
    );
  END IF;
END;
$$;