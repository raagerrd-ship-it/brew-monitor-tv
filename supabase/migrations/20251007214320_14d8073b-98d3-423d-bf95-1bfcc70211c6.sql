-- Enable pg_cron extension
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Enable pg_net extension for HTTP requests
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Create a cron job to sync brew data every 5 minutes
SELECT cron.schedule(
  'sync-brewfather-data',
  '*/5 * * * *', -- Every 5 minutes
  $$
  SELECT
    net.http_post(
      url:='https://plwchuzidrjgyuepwdcl.supabase.co/functions/v1/sync-brew-data',
      headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBsd2NodXppZHJqZ3l1ZXB3ZGNsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk0ODUyOTIsImV4cCI6MjA3NTA2MTI5Mn0.p9giTnFOK-b0NqrB4ZqN-3CJEaAqMNy-KYvRZ6P_qS0"}'::jsonb,
      body:='{}'::jsonb
    ) as request_id;
  $$
);