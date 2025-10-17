-- Force trigger to update cron schedule to correct interval
UPDATE sync_settings SET rapt_sync_interval = rapt_sync_interval;