
-- Rename the DB function
CREATE OR REPLACE FUNCTION public.trigger_ai_consultation()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE sync_settings SET last_full_sync_at = now();

  PERFORM net.http_post(
    url := 'https://plwchuzidrjgyuepwdcl.supabase.co/functions/v1/ai-consultation',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBsd2NodXppZHJqZ3l1ZXB3ZGNsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk0ODUyOTIsImV4cCI6MjA3NTA2MTI5Mn0.p9giTnFOK-b0NqrB4ZqN-3CJEaAqMNy-KYvRZ6P_qS0"}'::jsonb,
    body := '{}'::jsonb
  );
END;
$function$;

-- Drop old function
DROP FUNCTION IF EXISTS public.trigger_full_brew_sync();

-- Update cron schedule trigger to use new function name
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
  CASE NEW.rapt_sync_interval
    WHEN 60 THEN quick_schedule := '* * * * *';
    WHEN 300 THEN quick_schedule := '*/5 * * * *';
    WHEN 600 THEN quick_schedule := '*/10 * * * *';
    WHEN 900 THEN quick_schedule := '*/15 * * * *';
    WHEN 1800 THEN quick_schedule := '*/30 * * * *';
    WHEN 3600 THEN quick_schedule := '0 * * * *';
    ELSE quick_schedule := '*/5 * * * *';
  END CASE;

  PERFORM cron.unschedule('rapt-quick-sync');
  PERFORM cron.schedule(
    'rapt-quick-sync',
    quick_schedule,
    'SELECT public.trigger_rapt_quick_sync();'
  );

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
    
    BEGIN
      PERFORM cron.unschedule('ai-consultation');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    PERFORM cron.schedule(
      'ai-consultation',
      full_schedule,
      'SELECT public.trigger_ai_consultation();'
    );
  END IF;

  RETURN NEW;
END;
$function$;

-- Drop unused columns
ALTER TABLE public.sync_settings DROP COLUMN IF EXISTS last_rapt_full_sync_at;
ALTER TABLE public.sync_settings DROP COLUMN IF EXISTS last_sync_at;
