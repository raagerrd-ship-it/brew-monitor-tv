ALTER TABLE public.fermentation_sessions
  ADD COLUMN IF NOT EXISTS step_label text,
  ADD COLUMN IF NOT EXISTS step_progress numeric;