ALTER TABLE public.brew_status
  ADD COLUMN IF NOT EXISTS pi_brew_id uuid,
  ADD COLUMN IF NOT EXISTS step_index integer,
  ADD COLUMN IF NOT EXISTS step_label text,
  ADD COLUMN IF NOT EXISTS outcome text,
  ADD COLUMN IF NOT EXISTS racked_at timestamp with time zone;

COMMENT ON COLUMN public.brew_status.racked_at IS 'När ölet lämnade tanken. Slutrapport utan racked_at ersätts av en senare med.';