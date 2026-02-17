-- Add cooling/heating runtime statistics columns
ALTER TABLE public.rapt_temp_controllers 
ADD COLUMN IF NOT EXISTS cooling_run_time integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS cooling_starts integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS heating_run_time integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS heating_starts integer DEFAULT 0;
