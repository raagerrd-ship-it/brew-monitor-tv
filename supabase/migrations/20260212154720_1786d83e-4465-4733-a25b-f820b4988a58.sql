-- Add new fields from brewing API spec
ALTER TABLE public.cached_external_timer
  ADD COLUMN IF NOT EXISTS paused_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_config jsonb,
  ADD COLUMN IF NOT EXISTS wizard_step text,
  ADD COLUMN IF NOT EXISTS wizard_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS recipe_name text,
  ADD COLUMN IF NOT EXISTS beer_style text;