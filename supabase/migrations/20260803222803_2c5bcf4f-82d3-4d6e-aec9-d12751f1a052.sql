ALTER TABLE public.pi_live_state
  ADD COLUMN IF NOT EXISTS pump_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS pump_stopped_at timestamptz;