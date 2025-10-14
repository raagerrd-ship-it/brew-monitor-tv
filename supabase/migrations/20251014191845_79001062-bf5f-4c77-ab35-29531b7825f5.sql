-- Enable realtime for rapt_pills table
ALTER TABLE public.rapt_pills REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.rapt_pills;

-- Create cron job to sync RAPT Pills data every 15 minutes
SELECT cron.schedule(
  'rapt-pills-sync',
  '*/15 * * * *',
  $$
  SELECT
    net.http_post(
        url:='https://plwchuzidrjgyuepwdcl.supabase.co/functions/v1/sync-rapt-data',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBsd2NodXppZHJqZ3l1ZXB3ZGNsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk0ODUyOTIsImV4cCI6MjA3NTA2MTI5Mn0.p9giTnFOK-b0NqrB4ZqN-3CJEaAqMNy-KYvRZ6P_qS0"}'::jsonb,
        body:='{}'::jsonb
    ) as request_id;
  $$
);