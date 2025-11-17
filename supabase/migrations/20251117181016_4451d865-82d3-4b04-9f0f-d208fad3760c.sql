-- Create table for auto cooling adjustment logs
CREATE TABLE IF NOT EXISTS public.auto_cooling_adjustments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  cooler_controller_id TEXT NOT NULL,
  cooler_controller_name TEXT NOT NULL,
  old_target_temp NUMERIC NOT NULL,
  new_target_temp NUMERIC NOT NULL,
  lowest_followed_temp NUMERIC NOT NULL,
  reason TEXT NOT NULL
);

-- Enable RLS
ALTER TABLE public.auto_cooling_adjustments ENABLE ROW LEVEL SECURITY;

-- Create policy for viewing logs
CREATE POLICY "Anyone can view adjustment logs"
ON public.auto_cooling_adjustments
FOR SELECT
USING (true);

-- Create policy for service role to insert logs
CREATE POLICY "Service role can insert adjustment logs"
ON public.auto_cooling_adjustments
FOR INSERT
WITH CHECK (true);

-- Create index for faster queries
CREATE INDEX idx_auto_cooling_adjustments_created_at 
ON public.auto_cooling_adjustments(created_at DESC);