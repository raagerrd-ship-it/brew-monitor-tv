
-- Remove the trigger that causes cascading automation runs
-- Every update to rapt_temp_controllers currently re-triggers run-automation
DROP TRIGGER IF EXISTS automation_on_rapt_update ON rapt_temp_controllers;

-- Remove the separate fermentation-profile-processing cron job
-- run-automation (called from sync-rapt-data-quick) already includes this step
SELECT cron.unschedule('fermentation-profile-processing');
