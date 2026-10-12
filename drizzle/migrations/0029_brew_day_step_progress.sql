ALTER TABLE public.brew_day_session
  ADD COLUMN IF NOT EXISTS step_index integer,
  ADD COLUMN IF NOT EXISTS step_count integer,
  ADD COLUMN IF NOT EXISTS next_step_title text,
  ADD COLUMN IF NOT EXISTS next_step_minutes integer,
  ADD COLUMN IF NOT EXISTS next_step_items integer,
  ADD COLUMN IF NOT EXISTS step_started_at timestamptz;