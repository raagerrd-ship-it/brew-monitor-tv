
-- =============================================
-- CLEANUP: Remove orphaned functions and cron jobs
-- =============================================

-- Remove orphaned trigger function (trigger already dropped)
DROP FUNCTION IF EXISTS public.trigger_automation_on_rapt_update() CASCADE;

-- Remove orphaned fermentation profile trigger function (cron already unscheduled)
DROP FUNCTION IF EXISTS public.trigger_fermentation_profile_processing() CASCADE;

-- Remove redundant cron jobs
SELECT cron.unschedule('custom-brew-sync');
SELECT cron.unschedule('sync-brewfather-data');

-- Update the rapt sync cron schedule function to no longer manage custom-brew-sync
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
    WHEN 60 THEN cron_schedule := '* * * * *';
    WHEN 300 THEN cron_schedule := '*/5 * * * *';
    WHEN 600 THEN cron_schedule := '*/10 * * * *';
    WHEN 900 THEN cron_schedule := '*/15 * * * *';
    WHEN 1800 THEN cron_schedule := '*/30 * * * *';
    WHEN 3600 THEN cron_schedule := '0 * * * *';
    ELSE cron_schedule := '*/15 * * * *';
  END CASE;

  -- Update RAPT quick sync cron job (which now includes custom brew sync + automation)
  PERFORM cron.unschedule('rapt-quick-sync');
  PERFORM cron.schedule(
    'rapt-quick-sync',
    cron_schedule,
    'SELECT public.trigger_rapt_quick_sync();'
  );

  RETURN NEW;
END;
$function$;

-- =============================================
-- NEW: Pill compensation settings columns
-- =============================================
ALTER TABLE public.auto_cooling_settings
  ADD COLUMN IF NOT EXISTS pill_compensation_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS pill_compensation_damping numeric NOT NULL DEFAULT 0.4,
  ADD COLUMN IF NOT EXISTS pill_compensation_rate_limit numeric NOT NULL DEFAULT 0.3;
