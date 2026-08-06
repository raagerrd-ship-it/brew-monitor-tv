ALTER TABLE public.brew_readings
  ADD COLUMN IF NOT EXISTS volume_l numeric,
  ADD COLUMN IF NOT EXISTS pi_pending_at timestamptz;