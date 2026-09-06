DO $$ BEGIN PERFORM cron.unschedule('ai-consultation'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

DROP FUNCTION IF EXISTS public.trigger_ai_consultation();

CREATE OR REPLACE FUNCTION public.update_rapt_sync_cron_schedule()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  quick_schedule text;
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

  RETURN NEW;
END;
$function$;