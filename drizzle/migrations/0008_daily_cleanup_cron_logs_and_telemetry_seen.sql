CREATE INDEX IF NOT EXISTS idx_pi_telemetry_seen_received_at ON public.pi_telemetry_seen (received_at);

SELECT cron.schedule(
  'cleanup-cron-logs-and-telemetry-seen',
  '15 3 * * *',
  $$
  DELETE FROM cron.job_run_details WHERE end_time < now() - interval '3 days';
  DELETE FROM public.pi_telemetry_seen WHERE received_at < now() - interval '2 days';
  $$
);