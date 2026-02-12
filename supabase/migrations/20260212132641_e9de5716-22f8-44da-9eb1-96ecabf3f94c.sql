-- Remove old 10-second interval timer sync jobs
SELECT cron.unschedule('sync-external-timer-0');
SELECT cron.unschedule('sync-external-timer-10');
SELECT cron.unschedule('sync-external-timer-20');
SELECT cron.unschedule('sync-external-timer-30');
SELECT cron.unschedule('sync-external-timer-40');
SELECT cron.unschedule('sync-external-timer-50');

-- Re-create with 5-second intervals (12 jobs per minute)
SELECT cron.schedule('sync-external-timer-0', '* * * * *', 'SELECT public.trigger_external_timer_sync()');
SELECT cron.schedule('sync-external-timer-5', '* * * * *', 'SELECT pg_sleep(5); SELECT public.trigger_external_timer_sync()');
SELECT cron.schedule('sync-external-timer-10', '* * * * *', 'SELECT pg_sleep(10); SELECT public.trigger_external_timer_sync()');
SELECT cron.schedule('sync-external-timer-15', '* * * * *', 'SELECT pg_sleep(15); SELECT public.trigger_external_timer_sync()');
SELECT cron.schedule('sync-external-timer-20', '* * * * *', 'SELECT pg_sleep(20); SELECT public.trigger_external_timer_sync()');
SELECT cron.schedule('sync-external-timer-25', '* * * * *', 'SELECT pg_sleep(25); SELECT public.trigger_external_timer_sync()');
SELECT cron.schedule('sync-external-timer-30', '* * * * *', 'SELECT pg_sleep(30); SELECT public.trigger_external_timer_sync()');
SELECT cron.schedule('sync-external-timer-35', '* * * * *', 'SELECT pg_sleep(35); SELECT public.trigger_external_timer_sync()');
SELECT cron.schedule('sync-external-timer-40', '* * * * *', 'SELECT pg_sleep(40); SELECT public.trigger_external_timer_sync()');
SELECT cron.schedule('sync-external-timer-45', '* * * * *', 'SELECT pg_sleep(45); SELECT public.trigger_external_timer_sync()');
SELECT cron.schedule('sync-external-timer-50', '* * * * *', 'SELECT pg_sleep(50); SELECT public.trigger_external_timer_sync()');
SELECT cron.schedule('sync-external-timer-55', '* * * * *', 'SELECT pg_sleep(55); SELECT public.trigger_external_timer_sync()');
