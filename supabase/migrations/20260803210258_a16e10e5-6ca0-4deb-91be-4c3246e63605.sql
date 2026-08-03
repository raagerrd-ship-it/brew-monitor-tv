SELECT cron.unschedule('rapt-watchdog');
DROP TABLE IF EXISTS public.plug_commands;
DROP TABLE IF EXISTS public.plug_state;
DROP TABLE IF EXISTS public.watchdog_log;