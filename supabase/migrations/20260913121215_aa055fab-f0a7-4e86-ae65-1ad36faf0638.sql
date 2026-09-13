ALTER TABLE public.brew_status
  ADD COLUMN IF NOT EXISTS control_sensor text,
  ADD COLUMN IF NOT EXISTS temp_pt100_c numeric,
  ADD COLUMN IF NOT EXISTS temp_pill_c numeric;