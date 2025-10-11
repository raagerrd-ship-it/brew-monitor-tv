-- Fix search_path for update_sync_cron_schedule function
CREATE OR REPLACE FUNCTION public.update_sync_cron_schedule()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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