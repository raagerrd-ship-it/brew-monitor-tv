-- Update trigger function to always run every minute
CREATE OR REPLACE FUNCTION public.update_auto_cooling_cron_schedule()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Always run every minute to check and update countdown
  PERFORM cron.unschedule('auto-cooling-adjustment');
  PERFORM cron.schedule(
    'auto-cooling-adjustment',
    '* * * * *',  -- Every minute
    'SELECT public.trigger_auto_cooling_adjustment();'
  );

  RETURN NEW;
END;
$$;

-- Update the cron job to run every minute
DO $$
BEGIN
  PERFORM cron.unschedule('auto-cooling-adjustment');
  PERFORM cron.schedule(
    'auto-cooling-adjustment',
    '* * * * *',  -- Every minute
    'SELECT public.trigger_auto_cooling_adjustment();'
  );
END $$;