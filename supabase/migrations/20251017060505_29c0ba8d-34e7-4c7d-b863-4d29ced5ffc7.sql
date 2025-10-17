-- Remove old RAPT full sync cron job
SELECT cron.unschedule('rapt-pills-sync');