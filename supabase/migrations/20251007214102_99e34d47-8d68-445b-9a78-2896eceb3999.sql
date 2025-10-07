-- Create table for storing brew readings
CREATE TABLE public.brew_readings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  batch_id TEXT NOT NULL,
  name TEXT NOT NULL,
  style TEXT NOT NULL,
  batch_number TEXT NOT NULL,
  status TEXT NOT NULL,
  current_sg DECIMAL NOT NULL,
  current_temp DECIMAL NOT NULL,
  attenuation INTEGER NOT NULL,
  abv DECIMAL NOT NULL,
  original_gravity DECIMAL NOT NULL,
  final_gravity DECIMAL NOT NULL,
  last_update TIMESTAMP WITH TIME ZONE,
  sg_data JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create unique index on batch_id
CREATE UNIQUE INDEX idx_brew_readings_batch_id ON public.brew_readings(batch_id);

-- Enable Row Level Security
ALTER TABLE public.brew_readings ENABLE ROW LEVEL SECURITY;

-- Create policies for public read access
CREATE POLICY "Anyone can view brew readings" 
ON public.brew_readings 
FOR SELECT 
USING (true);

CREATE POLICY "Service role can insert brew readings" 
ON public.brew_readings 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Service role can update brew readings" 
ON public.brew_readings 
FOR UPDATE 
USING (true);

CREATE POLICY "Service role can delete brew readings" 
ON public.brew_readings 
FOR DELETE 
USING (true);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_brew_readings_updated_at
BEFORE UPDATE ON public.brew_readings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime for brew_readings table
ALTER PUBLICATION supabase_realtime ADD TABLE public.brew_readings;