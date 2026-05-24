ALTER TABLE public.rapt_temp_controllers
ADD COLUMN IF NOT EXISTS current_temp_updated_at TIMESTAMPTZ;

UPDATE public.rapt_temp_controllers
SET current_temp_updated_at = last_update
WHERE current_temp_updated_at IS NULL;