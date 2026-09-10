ALTER TABLE public.brew_status
  ADD COLUMN IF NOT EXISTS fermenting_done_at timestamptz,
  ADD COLUMN IF NOT EXISTS fermenting_done_basis text;