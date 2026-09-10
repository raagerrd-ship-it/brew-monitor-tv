ALTER TABLE public.brew_status
  ADD COLUMN IF NOT EXISTS volume_l numeric,
  ADD COLUMN IF NOT EXISTS abv_actual numeric,
  ADD COLUMN IF NOT EXISTS temp_max_c numeric,
  ADD COLUMN IF NOT EXISTS temp_min_c numeric,
  ADD COLUMN IF NOT EXISTS time_in_band_pct_per_step jsonb,
  ADD COLUMN IF NOT EXISTS sg_curve jsonb;