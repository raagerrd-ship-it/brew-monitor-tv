-- Add column to store the starting temperature when a step begins
ALTER TABLE public.fermentation_sessions 
ADD COLUMN step_start_temp numeric DEFAULT NULL;

-- Add comment for clarity
COMMENT ON COLUMN public.fermentation_sessions.step_start_temp IS 'The controller target temperature when the current step started, used for linear ramp calculations';