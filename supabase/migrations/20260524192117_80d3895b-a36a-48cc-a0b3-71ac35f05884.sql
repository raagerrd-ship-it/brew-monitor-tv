-- Phase 1+2: BLE-fresh-data optimizations

-- 1. Event-trigger throttle for PID runs from BLE ingest
CREATE TABLE public.pid_event_throttle (
  controller_id text PRIMARY KEY,
  last_run_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pid_event_throttle ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage pid event throttle"
ON public.pid_event_throttle
FOR ALL
USING (true)
WITH CHECK (true);

-- 2. Bump pill compensation rate-limit (BLE is 5× fresher than RAPT, kompensationen får röra sig snabbare)
UPDATE public.auto_cooling_settings
SET pill_compensation_rate_limit = 0.5,
    updated_at = now()
WHERE pill_compensation_rate_limit = 0.3;