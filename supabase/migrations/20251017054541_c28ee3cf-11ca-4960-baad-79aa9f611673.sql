-- Create function to trigger RAPT quick sync
CREATE OR REPLACE FUNCTION public.trigger_rapt_quick_sync()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  -- Call edge function
  PERFORM net.http_post(
    url := 'https://plwchuzidrjgyuepwdcl.supabase.co/functions/v1/sync-rapt-data-quick',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBsd2NodXppZHJqZ3l1ZXB3ZGNsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk0ODUyOTIsImV4cCI6MjA3NTA2MTI5Mn0.p9giTnFOK-b0NqrB4ZqN-3CJEaAqMNy-KYvRZ6P_qS0"}'::jsonb,
    body := '{}'::jsonb
  );
END;
$$;

-- Create trigger function to update RAPT sync cron schedule
CREATE OR REPLACE FUNCTION public.update_rapt_sync_cron_schedule()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  cron_schedule text;
BEGIN
  -- Convert rapt_sync_interval (seconds) to cron schedule
  CASE NEW.rapt_sync_interval
    WHEN 60 THEN cron_schedule := '* * * * *';           -- Every minute
    WHEN 300 THEN cron_schedule := '*/5 * * * *';        -- Every 5 minutes
    WHEN 600 THEN cron_schedule := '*/10 * * * *';       -- Every 10 minutes
    WHEN 900 THEN cron_schedule := '*/15 * * * *';       -- Every 15 minutes
    WHEN 1800 THEN cron_schedule := '*/30 * * * *';      -- Every 30 minutes
    WHEN 3600 THEN cron_schedule := '0 * * * *';         -- Every hour
    ELSE cron_schedule := '*/15 * * * *';                -- Default to every 15 minutes
  END CASE;

  -- Update the cron job
  PERFORM cron.unschedule('rapt-quick-sync');
  PERFORM cron.schedule(
    'rapt-quick-sync',
    cron_schedule,
    'SELECT public.trigger_rapt_quick_sync();'
  );

  RETURN NEW;
END;
$$;

-- Create trigger on sync_settings to update cron when rapt_sync_interval changes
DROP TRIGGER IF EXISTS update_rapt_sync_cron_trigger ON sync_settings;
CREATE TRIGGER update_rapt_sync_cron_trigger
AFTER INSERT OR UPDATE OF rapt_sync_interval ON sync_settings
FOR EACH ROW
EXECUTE FUNCTION update_rapt_sync_cron_schedule();

-- Initialize the cron job with current settings
DO $$
DECLARE
  current_interval integer;
  cron_schedule text;
BEGIN
  -- Get current rapt_sync_interval
  SELECT rapt_sync_interval INTO current_interval FROM sync_settings LIMIT 1;
  
  -- Convert to cron schedule
  CASE current_interval
    WHEN 60 THEN cron_schedule := '* * * * *';
    WHEN 300 THEN cron_schedule := '*/5 * * * *';
    WHEN 600 THEN cron_schedule := '*/10 * * * *';
    WHEN 900 THEN cron_schedule := '*/15 * * * *';
    WHEN 1800 THEN cron_schedule := '*/30 * * * *';
    WHEN 3600 THEN cron_schedule := '0 * * * *';
    ELSE cron_schedule := '*/15 * * * *';
  END CASE;
  
  -- Schedule the cron job
  PERFORM cron.schedule(
    'rapt-quick-sync',
    cron_schedule,
    'SELECT public.trigger_rapt_quick_sync();'
  );
END;
$$;