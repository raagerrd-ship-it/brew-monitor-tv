ALTER TABLE public.rapt_temp_controllers
  ADD COLUMN IF NOT EXISTS pill_probe_offset NUMERIC,
  ADD COLUMN IF NOT EXISTS pill_probe_offset_baseline NUMERIC,
  ADD COLUMN IF NOT EXISTS pill_probe_offset_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_hw_push_at TIMESTAMPTZ;