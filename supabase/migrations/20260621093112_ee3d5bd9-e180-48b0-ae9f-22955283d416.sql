ALTER TABLE public.cached_external_timer
  ADD COLUMN IF NOT EXISTS timer_action text,
  ADD COLUMN IF NOT EXISTS timer_target_temperature numeric;