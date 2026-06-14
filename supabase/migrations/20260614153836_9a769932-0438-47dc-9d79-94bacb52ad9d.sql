ALTER TABLE public.fermentation_profile_steps
  ADD COLUMN IF NOT EXISTS stability_window_minutes integer,
  ADD COLUMN IF NOT EXISTS stability_max_deviation numeric;