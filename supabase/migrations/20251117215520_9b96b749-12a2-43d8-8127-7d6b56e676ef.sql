-- Create function to trigger auto cooling adjustment
CREATE OR REPLACE FUNCTION public.trigger_auto_cooling_adjustment()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Call edge function
  PERFORM net.http_post(
    url := 'https://plwchuzidrjgyuepwdcl.supabase.co/functions/v1/auto-adjust-cooling',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBsd2NodXppZHJqZ3l1ZXB3ZGNsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk0ODUyOTIsImV4cCI6MjA3NTA2MTI5Mn0.p9giTnFOK-b0NqrB4ZqN-3CJEaAqMNy-KYvRZ6P_qS0"}'::jsonb,
    body := '{}'::jsonb
  );
END;
$$;

-- Create trigger function to update cron schedule when check_interval changes
CREATE OR REPLACE FUNCTION public.update_auto_cooling_cron_schedule()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cron_schedule text;
BEGIN
  -- Convert check_interval_minutes to cron schedule
  CASE NEW.check_interval_minutes
    WHEN 15 THEN cron_schedule := '*/15 * * * *';   -- Every 15 minutes
    WHEN 30 THEN cron_schedule := '*/30 * * * *';   -- Every 30 minutes
    WHEN 60 THEN cron_schedule := '0 * * * *';      -- Every hour
    WHEN 120 THEN cron_schedule := '0 */2 * * *';   -- Every 2 hours
    ELSE cron_schedule := '0 * * * *';              -- Default to every hour
  END CASE;

  -- Update the cron job
  PERFORM cron.unschedule('auto-cooling-adjustment');
  PERFORM cron.schedule(
    'auto-cooling-adjustment',
    cron_schedule,
    'SELECT public.trigger_auto_cooling_adjustment();'
  );

  RETURN NEW;
END;
$$;

-- Create trigger on auto_cooling_settings to update cron when interval changes
DROP TRIGGER IF EXISTS update_auto_cooling_cron_trigger ON auto_cooling_settings;
CREATE TRIGGER update_auto_cooling_cron_trigger
  AFTER INSERT OR UPDATE OF check_interval_minutes ON auto_cooling_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_auto_cooling_cron_schedule();

-- Initialize the cron job with current settings
DO $$
DECLARE
  current_interval integer;
  cron_schedule text;
BEGIN
  SELECT check_interval_minutes INTO current_interval FROM auto_cooling_settings LIMIT 1;
  
  CASE current_interval
    WHEN 15 THEN cron_schedule := '*/15 * * * *';
    WHEN 30 THEN cron_schedule := '*/30 * * * *';
    WHEN 60 THEN cron_schedule := '0 * * * *';
    WHEN 120 THEN cron_schedule := '0 */2 * * *';
    ELSE cron_schedule := '0 * * * *';
  END CASE;

  PERFORM cron.unschedule('auto-cooling-adjustment');
  PERFORM cron.schedule(
    'auto-cooling-adjustment',
    cron_schedule,
    'SELECT public.trigger_auto_cooling_adjustment();'
  );
END $$;