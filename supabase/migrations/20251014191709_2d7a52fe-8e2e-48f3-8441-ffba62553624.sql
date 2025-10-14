-- Create table for RAPT Pills
CREATE TABLE public.rapt_pills (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pill_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  battery_level INTEGER NOT NULL,
  last_update TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.rapt_pills ENABLE ROW LEVEL SECURITY;

-- Create policies for public access (no authentication required)
CREATE POLICY "Anyone can view pills" 
ON public.rapt_pills 
FOR SELECT 
USING (true);

CREATE POLICY "Service role can insert pills" 
ON public.rapt_pills 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Service role can update pills" 
ON public.rapt_pills 
FOR UPDATE 
USING (true);

CREATE POLICY "Service role can delete pills" 
ON public.rapt_pills 
FOR DELETE 
USING (true);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_rapt_pills_updated_at
BEFORE UPDATE ON public.rapt_pills
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();