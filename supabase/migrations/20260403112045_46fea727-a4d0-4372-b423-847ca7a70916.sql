-- Drop unused trigger_brew_sync
DROP FUNCTION IF EXISTS public.trigger_brew_sync();

-- Remove redundant cron job
SELECT cron.unschedule('check-full-brew-sync');

-- Simplify trigger_full_brew_sync — just update timestamp and call edge function
CREATE OR REPLACE FUNCTION public.trigger_full_brew_sync()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE sync_settings SET last_full_sync_at = now();

  PERFORM net.http_post(
    url := 'https://plwchuzidrjgyuepwdcl.supabase.co/functions/v1/full-sync-brew-data',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBsd2NodXppZHJqZ3l1ZXB3ZGNsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk0ODUyOTIsImV4cCI6MjA3NTA2MTI5Mn0.p9giTnFOK-b0NqrB4ZqN-3CJEaAqMNy-KYvRZ6P_qS0"}'::jsonb,
    body := '{}'::jsonb
  );
END;
$function$;

-- Also clean up the update_rapt_sync_cron_schedule trigger function
-- to remove the reference to trigger_brew_sync and check-full-brew-sync
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

    BEGIN
      PERFORM cron.unschedule('full-brew-sync');
    EXCEPTION WHEN OTHERS THEN
      NULL;
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