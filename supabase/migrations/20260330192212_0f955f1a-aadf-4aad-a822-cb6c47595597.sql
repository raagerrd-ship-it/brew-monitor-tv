-- Pause sonos cron job (bridge-push now drives updates)
-- To re-enable: SELECT cron.schedule('sonos-now-playing-sync', '* * * * *', 'SELECT public.trigger_sonos_now_playing_sync();');
SELECT cron.unschedule('sonos-now-playing-sync');