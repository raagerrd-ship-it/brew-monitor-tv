ALTER TABLE public.brew_data_snapshots ADD COLUMN IF NOT EXISTS actual_temp NUMERIC;

-- Backfill from auto_target_temp (which was storing the fused value)
UPDATE public.brew_data_snapshots SET actual_temp = auto_target_temp WHERE auto_target_temp IS NOT NULL AND actual_temp IS NULL;