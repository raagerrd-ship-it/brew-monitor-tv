ALTER TABLE public.sync_settings
  ADD COLUMN IF NOT EXISTS pill_stale_threshold_min INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS probe_stale_threshold_min INTEGER NOT NULL DEFAULT 31;