-- Update the trigger to also schedule custom brew sync with same interval as RAPT sync
CREATE OR REPLACE FUNCTION public.update_rapt_sync_cron_schedule()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  -- Update RAPT quick sync cron job
  PERFORM cron.unschedule('rapt-quick-sync');
  PERFORM cron.schedule(
    'rapt-quick-sync',
    cron_schedule,
    'SELECT public.trigger_rapt_quick_sync();'
  );

  -- Update custom brew sync cron job with same schedule
  PERFORM cron.unschedule('custom-brew-sync');
  PERFORM cron.schedule(
    'custom-brew-sync',
    cron_schedule,
    'SELECT public.trigger_custom_brew_sync();'
  );

  RETURN NEW;
END;
$function$;