-- Create brew_events table for tracking important brewing events
CREATE TABLE public.brew_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  brew_id UUID NOT NULL REFERENCES public.brew_readings(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  event_date TIMESTAMP WITH TIME ZONE NOT NULL,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.brew_events ENABLE ROW LEVEL SECURITY;

-- Create policies for viewing events
CREATE POLICY "Anyone can view brew events" 
ON public.brew_events 
FOR SELECT 
USING (true);

-- Create policies for inserting events (anyone can add events)
CREATE POLICY "Anyone can insert brew events" 
ON public.brew_events 
FOR INSERT 
WITH CHECK (true);

-- Create policies for updating events
CREATE POLICY "Anyone can update brew events" 
ON public.brew_events 
FOR UPDATE 
USING (true);

-- Create policies for deleting events
CREATE POLICY "Anyone can delete brew events" 
ON public.brew_events 
FOR DELETE 
USING (true);

-- Add trigger for automatic timestamp updates
CREATE TRIGGER update_brew_events_updated_at
BEFORE UPDATE ON public.brew_events
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create index for faster queries by brew_id
CREATE INDEX idx_brew_events_brew_id ON public.brew_events(brew_id);

-- Create index for faster queries by event_date
CREATE INDEX idx_brew_events_date ON public.brew_events(event_date);