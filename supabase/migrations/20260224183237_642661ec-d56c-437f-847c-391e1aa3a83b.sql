-- Add is_glycol_cooler flag to rapt_temp_controllers
ALTER TABLE public.rapt_temp_controllers 
ADD COLUMN is_glycol_cooler boolean NOT NULL DEFAULT false;