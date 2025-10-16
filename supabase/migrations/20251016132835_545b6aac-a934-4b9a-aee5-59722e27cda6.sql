-- Create table for RAPT Temperature Controllers
CREATE TABLE IF NOT EXISTS public.rapt_temp_controllers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  controller_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  current_temp NUMERIC,
  target_temp NUMERIC,
  last_update TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.rapt_temp_controllers ENABLE ROW LEVEL SECURITY;

-- Create policies for public viewing
CREATE POLICY "Anyone can view temp controllers" 
ON public.rapt_temp_controllers 
FOR SELECT 
USING (true);

CREATE POLICY "Service role can insert temp controllers" 
ON public.rapt_temp_controllers 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Service role can update temp controllers" 
ON public.rapt_temp_controllers 
FOR UPDATE 
USING (true);

CREATE POLICY "Service role can delete temp controllers" 
ON public.rapt_temp_controllers 
FOR DELETE 
USING (true);

-- Create index for faster lookups
CREATE INDEX idx_rapt_temp_controllers_controller_id ON public.rapt_temp_controllers(controller_id);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.rapt_temp_controllers;