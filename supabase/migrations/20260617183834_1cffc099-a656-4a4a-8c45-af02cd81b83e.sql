
CREATE TABLE public.watchdog_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  controller text,
  last_reading_at timestamptz,
  age_minutes numeric,
  action text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.watchdog_log TO anon, authenticated;
GRANT ALL ON public.watchdog_log TO service_role;

ALTER TABLE public.watchdog_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view watchdog log"
  ON public.watchdog_log FOR SELECT
  USING (true);

CREATE INDEX idx_watchdog_log_created_at ON public.watchdog_log (created_at DESC);

-- ensure required extensions for scheduling
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
