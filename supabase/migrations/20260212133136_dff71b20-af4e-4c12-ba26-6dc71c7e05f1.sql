-- Remove all 3-second interval timer sync jobs (client now handles frequent syncing)
SELECT cron.unschedule('sync-external-timer-0');
SELECT cron.unschedule('sync-external-timer-3');
SELECT cron.unschedule('sync-external-timer-6');
SELECT cron.unschedule('sync-external-timer-9');
SELECT cron.unschedule('sync-external-timer-12');
SELECT cron.unschedule('sync-external-timer-15');
SELECT cron.unschedule('sync-external-timer-18');
SELECT cron.unschedule('sync-external-timer-21');
SELECT cron.unschedule('sync-external-timer-24');
SELECT cron.unschedule('sync-external-timer-27');
SELECT cron.unschedule('sync-external-timer-30');
SELECT cron.unschedule('sync-external-timer-33');
SELECT cron.unschedule('sync-external-timer-36');
SELECT cron.unschedule('sync-external-timer-39');
SELECT cron.unschedule('sync-external-timer-42');
SELECT cron.unschedule('sync-external-timer-45');
SELECT cron.unschedule('sync-external-timer-48');
SELECT cron.unschedule('sync-external-timer-51');
SELECT cron.unschedule('sync-external-timer-54');
SELECT cron.unschedule('sync-external-timer-57');

-- Re-create with 10-second intervals as fallback only (6 jobs)
SELECT cron.schedule('sync-external-timer-0', '* * * * *', 'SELECT public.trigger_external_timer_sync()');
SELECT cron.schedule('sync-external-timer-10', '* * * * *', 'SELECT pg_sleep(10); SELECT public.trigger_external_timer_sync()');
SELECT cron.schedule('sync-external-timer-20', '* * * * *', 'SELECT pg_sleep(20); SELECT public.trigger_external_timer_sync()');
SELECT cron.schedule('sync-external-timer-30', '* * * * *', 'SELECT pg_sleep(30); SELECT public.trigger_external_timer_sync()');
SELECT cron.schedule('sync-external-timer-40', '* * * * *', 'SELECT pg_sleep(40); SELECT public.trigger_external_timer_sync()');
SELECT cron.schedule('sync-external-timer-50', '* * * * *', 'SELECT pg_sleep(50); SELECT public.trigger_external_timer_sync()');
