-- Remove old 5-second interval timer sync jobs
SELECT cron.unschedule('sync-external-timer-0');
SELECT cron.unschedule('sync-external-timer-5');
SELECT cron.unschedule('sync-external-timer-10');
SELECT cron.unschedule('sync-external-timer-15');
SELECT cron.unschedule('sync-external-timer-20');
SELECT cron.unschedule('sync-external-timer-25');
SELECT cron.unschedule('sync-external-timer-30');
SELECT cron.unschedule('sync-external-timer-35');
SELECT cron.unschedule('sync-external-timer-40');
SELECT cron.unschedule('sync-external-timer-45');
SELECT cron.unschedule('sync-external-timer-50');
SELECT cron.unschedule('sync-external-timer-55');

-- Re-create with 3-second intervals (20 jobs per minute)
SELECT cron.schedule('sync-external-timer-0', '* * * * *', 'SELECT public.trigger_external_timer_sync()');
SELECT cron.schedule('sync-external-timer-3', '* * * * *', 'SELECT pg_sleep(3); SELECT public.trigger_external_timer_sync()');
SELECT cron.schedule('sync-external-timer-6', '* * * * *', 'SELECT pg_sleep(6); SELECT public.trigger_external_timer_sync()');
SELECT cron.schedule('sync-external-timer-9', '* * * * *', 'SELECT pg_sleep(9); SELECT public.trigger_external_timer_sync()');
SELECT cron.schedule('sync-external-timer-12', '* * * * *', 'SELECT pg_sleep(12); SELECT public.trigger_external_timer_sync()');
SELECT cron.schedule('sync-external-timer-15', '* * * * *', 'SELECT pg_sleep(15); SELECT public.trigger_external_timer_sync()');
SELECT cron.schedule('sync-external-timer-18', '* * * * *', 'SELECT pg_sleep(18); SELECT public.trigger_external_timer_sync()');
SELECT cron.schedule('sync-external-timer-21', '* * * * *', 'SELECT pg_sleep(21); SELECT public.trigger_external_timer_sync()');
SELECT cron.schedule('sync-external-timer-24', '* * * * *', 'SELECT pg_sleep(24); SELECT public.trigger_external_timer_sync()');
SELECT cron.schedule('sync-external-timer-27', '* * * * *', 'SELECT pg_sleep(27); SELECT public.trigger_external_timer_sync()');
SELECT cron.schedule('sync-external-timer-30', '* * * * *', 'SELECT pg_sleep(30); SELECT public.trigger_external_timer_sync()');
SELECT cron.schedule('sync-external-timer-33', '* * * * *', 'SELECT pg_sleep(33); SELECT public.trigger_external_timer_sync()');
SELECT cron.schedule('sync-external-timer-36', '* * * * *', 'SELECT pg_sleep(36); SELECT public.trigger_external_timer_sync()');
SELECT cron.schedule('sync-external-timer-39', '* * * * *', 'SELECT pg_sleep(39); SELECT public.trigger_external_timer_sync()');
SELECT cron.schedule('sync-external-timer-42', '* * * * *', 'SELECT pg_sleep(42); SELECT public.trigger_external_timer_sync()');
SELECT cron.schedule('sync-external-timer-45', '* * * * *', 'SELECT pg_sleep(45); SELECT public.trigger_external_timer_sync()');
SELECT cron.schedule('sync-external-timer-48', '* * * * *', 'SELECT pg_sleep(48); SELECT public.trigger_external_timer_sync()');
SELECT cron.schedule('sync-external-timer-51', '* * * * *', 'SELECT pg_sleep(51); SELECT public.trigger_external_timer_sync()');
SELECT cron.schedule('sync-external-timer-54', '* * * * *', 'SELECT pg_sleep(54); SELECT public.trigger_external_timer_sync()');
SELECT cron.schedule('sync-external-timer-57', '* * * * *', 'SELECT pg_sleep(57); SELECT public.trigger_external_timer_sync()');
