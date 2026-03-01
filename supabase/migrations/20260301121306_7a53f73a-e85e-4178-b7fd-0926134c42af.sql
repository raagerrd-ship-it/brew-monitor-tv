
-- Remove the brew-data-sync cron job (Brewfather quick sync is now part of rapt-quick-sync)
SELECT cron.unschedule('brew-data-sync');

-- Update the trigger function to handle both quick and full sync cron schedules
CREATE OR REPLACE FUNCTION public.update_rapt_sync_cron_schedule()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  quick_schedule text;
  full_schedule text;
BEGIN
  -- Convert rapt_sync_interval (seconds) to cron schedule for quick sync
  CASE NEW.rapt_sync_interval
    WHEN 60 THEN quick_schedule := '* * * * *';
    WHEN 300 THEN quick_schedule := '*/5 * * * *';
    WHEN 600 THEN quick_schedule := '*/10 * * * *';
    WHEN 900 THEN quick_schedule := '*/15 * * * *';
    WHEN 1800 THEN quick_schedule := '*/30 * * * *';
    WHEN 3600 THEN quick_schedule := '0 * * * *';
    ELSE quick_schedule := '*/5 * * * *';
  END CASE;

  -- Update quick sync cron job
  PERFORM cron.unschedule('rapt-quick-sync');
  PERFORM cron.schedule(
    'rapt-quick-sync',
    quick_schedule,
    'SELECT public.trigger_rapt_quick_sync();'
  );

  -- Convert full_sync_interval (seconds) to cron schedule
  IF NEW.full_sync_interval IS NOT NULL AND NEW.full_sync_interval > 0 THEN
    CASE NEW.full_sync_interval
      WHEN 3600 THEN full_schedule := '0 * * * *';
      WHEN 21600 THEN full_schedule := '0 */6 * * *';
      WHEN 43200 THEN full_schedule := '0 */12 * * *';
      WHEN 86400 THEN full_schedule := '0 4 * * *';
      ELSE full_schedule := '0 */6 * * *';
    END CASE;

    -- Unschedule existing full sync cron if it exists
    BEGIN
      PERFORM cron.unschedule('full-brew-sync');
    EXCEPTION WHEN OTHERS THEN
      NULL; -- ignore if doesn't exist
    END;
    
    PERFORM cron.schedule(
      'full-brew-sync',
      full_schedule,
      'SELECT public.trigger_full_brew_sync();'
    );
  END IF;

  RETURN NEW;
END;
$function$;

-- Drop the old brew sync cron trigger function (no longer needed separately)
DROP FUNCTION IF EXISTS public.update_sync_cron_schedule() CASCADE;

-- Schedule the full sync cron job (every 6 hours by default)
SELECT cron.schedule(
  'full-brew-sync',
  '0 */6 * * *',
  'SELECT public.trigger_full_brew_sync();'
);
