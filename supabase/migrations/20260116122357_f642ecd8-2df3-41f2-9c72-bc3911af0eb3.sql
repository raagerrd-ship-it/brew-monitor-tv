-- Schedule the fermentation profile processing to run every 5 minutes
SELECT cron.schedule(
  'fermentation-profile-processing',
  '*/5 * * * *',
  'SELECT public.trigger_fermentation_profile_processing();'
);