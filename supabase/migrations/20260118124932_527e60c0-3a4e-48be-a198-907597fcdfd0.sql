-- Create function to trigger external timer sync
CREATE OR REPLACE FUNCTION public.trigger_external_timer_sync()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Call edge function
  PERFORM net.http_post(
    url := 'https://plwchuzidrjgyuepwdcl.supabase.co/functions/v1/sync-external-timer',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBsd2NodXppZHJqZ3l1ZXB3ZGNsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk0ODUyOTIsImV4cCI6MjA3NTA2MTI5Mn0.p9giTnFOK-b0NqrB4ZqN-3CJEaAqMNy-KYvRZ6P_qS0"}'::jsonb,
    body := '{}'::jsonb
  );
END;
$$;

-- Schedule cron job to sync every 30 seconds (using two jobs since pg_cron minimum is 1 minute)
SELECT cron.schedule(
  'sync-external-timer-1',
  '* * * * *',
  'SELECT public.trigger_external_timer_sync();'
);

-- Add a second job with 30 second offset by waiting
SELECT cron.schedule(
  'sync-external-timer-2',
  '* * * * *',
  $$SELECT pg_sleep(30); SELECT public.trigger_external_timer_sync();$$
);